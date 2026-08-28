/**
 * 扫码登录路由：发起登录 → SSE 推二维码/状态 → 成功后 AuthStore 双写 WebDAV。
 * 注意：Hono 的 .post/.get 是不可变方法，必须链式调用，否则 schema 推断失效（BlankSchema）。
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { AuthStore, qrcodeLogin } from "@sakurachiyo0v0/account";
import { createAuthNamespace } from "../bootstrap.js";
import {
  addListener,
  broadcast,
  createSession,
  getSession,
  updateSession,
} from "../auth-sessions.js";
import { getAuthAdapter, isSupportedPlatform, type SupportedPlatform } from "../adapters.js";

/** 后台跑扫码登录：二维码/状态经 SSE 广播；成功后 qrcodeLogin 内部 store.save 双写 WebDAV。 */
async function runLogin(platform: SupportedPlatform, sessionId: string): Promise<void> {
  const adapter = getAuthAdapter(platform);
  try {
    const store = new AuthStore({ platform, remote: createAuthNamespace() });
    await qrcodeLogin({
      adapter,
      store,
      autoOpenBrowser: false,
      onQrCode: (qrDataUrl) => {
        updateSession(sessionId, { qrDataUrl, state: "waiting", message: "请使用网易云音乐 App 扫码" });
        void broadcast(sessionId, { event: "qr", data: { qrDataUrl } });
      },
      onStatus: (status) => {
        updateSession(sessionId, { state: status.state, message: status.message });
        void broadcast(sessionId, { event: "status", data: { state: status.state, message: status.message } });
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    updateSession(sessionId, { state: "failed", message });
    void broadcast(sessionId, { event: "status", data: { state: "failed", message: "登录失败，请重试" } });
  }
}

export const authRoutes = new Hono()
  /** POST /api/auth/start —— 发起扫码登录，返回会话 id（前端凭此订阅 SSE）。 */
  .post("/start", async (c) => {
    const body = await c.req.json<{ platform?: unknown }>().catch(() => ({ platform: undefined }));
    const platform = body.platform;
    if (typeof platform !== "string" || !isSupportedPlatform(platform)) {
      return c.json({ error: `不支持的平台: ${String(platform)}` }, 400);
    }
    const session = createSession(platform);
    void runLogin(platform, session.id);
    return c.json({ sessionId: session.id });
  })
  /** GET /api/auth/stream?id=xxx —— SSE 流：推二维码与状态变化。 */
  .get("/stream", (c) => {
    const id = c.req.query("id");
    if (id === undefined) return c.json({ error: "missing id" }, 400);
    const session = getSession(id);
    if (session === undefined) return c.json({ error: "session not found" }, 404);

    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });
      const off = addListener(id, stream);
      try {
        if (session.qrDataUrl !== undefined) {
          await stream.writeSSE({ event: "qr", data: JSON.stringify({ qrDataUrl: session.qrDataUrl }) });
        }
        await stream.writeSSE({
          event: "status",
          data: JSON.stringify({ state: session.state, message: session.message ?? "" }),
        });
        // 保活：心跳，等待广播或连接关闭。
        while (!aborted) {
          await stream.sleep(15_000);
        }
      } catch {
        // 连接关闭或写失败，静默退出。
      } finally {
        off();
      }
    });
  })
  /** GET /api/auth/session?id=xxx —— 查询会话当前状态（前端刷新后恢复）。 */
  .get("/session", (c) => {
    const id = c.req.query("id");
    if (id === undefined) return c.json({ error: "missing id" }, 400);
    const session = getSession(id);
    if (session === undefined) return c.json({ error: "session not found" }, 404);
    return c.json({
      state: session.state,
      message: session.message ?? "",
      ...(session.qrDataUrl !== undefined ? { qrDataUrl: session.qrDataUrl } : {}),
    });
  });
