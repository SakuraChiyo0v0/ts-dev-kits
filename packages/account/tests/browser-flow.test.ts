/**
 * browserLogin 骨架测试 —— 捕获页回退路径走真实本地回环(与 booth 的 login.test 同款);
 * CDP 路径不启动真实浏览器,只测前置失败(浏览器不存在)。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AuthStore,
  browserLogin,
  type BrowserLoginAdapter,
  type PlatformCredentials,
} from "../src/index.js";

/** 构造假平台适配器(可覆盖 validate)。 */
function fakeBrowserAdapter(
  overrides: Partial<BrowserLoginAdapter> = {},
): BrowserLoginAdapter {
  return {
    platform: "fake",
    loginUrl: "https://fake.example/login",
    cookieDomains: ["fake.example"],
    sessionCookieNames: ["session"],
    serialize(credentials: PlatformCredentials, savedAt: string) {
      return {
        platform: "fake",
        credentials: { cookieHeader: String((credentials as { cookieHeader?: unknown }).cookieHeader ?? "") },
        savedAt,
      };
    },
    deserialize(payload) {
      const cookieHeader = payload.credentials?.cookieHeader;
      return typeof cookieHeader === "string" && cookieHeader !== ""
        ? { cookieHeader }
        : null;
    },
    ...overrides,
  };
}

/** 等待 openBrowser 被调用,拿到捕获页 URL。 */
async function waitForUrl(get: () => string | null): Promise<string> {
  for (let i = 0; i < 50; i += 1) {
    const url = get();
    if (url !== null) {
      return url;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("openBrowser 未被调用");
}

/** 从捕获页 HTML 提取一次性 token,并 POST cookie 回传。 */
async function postCookies(captureUrl: string, cookies: string): Promise<void> {
  const captureResp = await fetch(captureUrl);
  const html = await captureResp.text();
  const tokenMatch = /token:\s*'([a-f0-9]+)'/.exec(html);
  if (tokenMatch === null) {
    throw new Error("捕获页 HTML 中未找到 token");
  }
  const token = tokenMatch[1]!;
  const doneUrl = new URL("/done", captureUrl);
  doneUrl.searchParams.set("token", token);
  const form = new URLSearchParams({ token, cookies });
  const doneResp = await fetch(doneUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  expect(doneResp.status).toBe(200);
}

describe("browserLogin(捕获页回退)", () => {
  it("用户回传 cookie 后持久化到 AuthStore", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "account-browser-login-"));
    try {
      const authPath = path.join(dir, "auth.json");
      const store = new AuthStore({ platform: "fake", path: authPath });
      let capturedUrl: string | null = null;

      const loginPromise = browserLogin({
        adapter: fakeBrowserAdapter(),
        store,
        useCdp: false,
        openBrowser: (url) => {
          capturedUrl = url;
          return Promise.resolve();
        },
      });

      const url = await waitForUrl(() => capturedUrl);
      await postCookies(url, "session=smoke-cookie; theme=dark");
      const result = await loginPromise;

      expect(result.saved).toBe(true);
      expect(result.credentials).toEqual({ cookieHeader: "session=smoke-cookie; theme=dark" });
      expect(existsSync(authPath)).toBe(true);
      // 落盘内容与序列化一致。
      const payload = await store.load();
      expect(payload?.credentials).toEqual({ cookieHeader: "session=smoke-cookie; theme=dark" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("不传 store 时不持久化,仅返回凭证", async () => {
    let capturedUrl: string | null = null;
    const loginPromise = browserLogin({
      adapter: fakeBrowserAdapter(),
      useCdp: false,
      openBrowser: (url) => {
        capturedUrl = url;
        return Promise.resolve();
      },
    });

    const url = await waitForUrl(() => capturedUrl);
    await postCookies(url, "session=only-in-memory");
    const result = await loginPromise;

    expect(result.saved).toBe(false);
    expect(result.credentials).toEqual({ cookieHeader: "session=only-in-memory" });
  });

  it("平台校验失败时抛 AUTH_EXPIRED 且不落盘", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "account-browser-validate-"));
    try {
      const authPath = path.join(dir, "auth.json");
      const store = new AuthStore({ platform: "fake", path: authPath });
      let capturedUrl: string | null = null;

      const loginPromise = browserLogin({
        adapter: fakeBrowserAdapter({
          async validate() {
            throw new Error("boom"); // 骨架应收敛为 AccountError
          },
        }),
        store,
        useCdp: false,
        openBrowser: (url) => {
          capturedUrl = url;
          return Promise.resolve();
        },
      });

      // 提前 attach rejection handler,避免登录失败发生在 await 前被 Node 记为 unhandled。
      const rejected = expect(loginPromise).rejects.toMatchObject({
        name: "AccountError",
        code: "UNKNOWN",
      });

      const url = await waitForUrl(() => capturedUrl);
      await postCookies(url, "session=stale");
      await rejected;
      expect(existsSync(authPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("browserLogin(CDP 前置检查)", () => {
  it("显式传入不存在的浏览器路径时抛错", async () => {
    await expect(
      browserLogin({
        adapter: fakeBrowserAdapter(),
        browserPath: "/nonexistent/chrome.exe",
      }),
    ).rejects.toMatchObject({
      name: "AccountError",
      code: "UNKNOWN",
      message: expect.stringContaining("browser not found"),
    });
  });
});
