import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loginBooth } from "../src/client.js";

describe("loginBooth", () => {
  it("捕获页回传 cookie 后持久化(走本机回环)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "booth-login-"));
    try {
      const authPath = path.join(dir, "auth.json");
      let capturedUrl: string | null = null;

      const loginPromise = loginBooth({
        authPath,
        useCdp: false,
        openBrowser: (url) => {
          capturedUrl = url;
          return Promise.resolve();
        },
        fetchImpl: async (input: string | URL | Request) => {
          // 校验请求:捕获页 GET / 用户订单页校验。
          const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(String(input));
          if (url.pathname === "/orders") {
            return new Response("<!doctype html><html><body>購入履歴 logged in</body></html>", { status: 200 });
          }
          return new Response("not found", { status: 404 });
        },
      });

      // 等 openBrowser 被调用,拿到捕获页 URL。
      for (let i = 0; i < 50 && capturedUrl === null; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(capturedUrl).not.toBeNull();

      // 向 /done POST cookie(模拟捕获页表单回传)。
      const doneUrl = new URL("/done", capturedUrl!);
      doneUrl.searchParams.set("token", "");
      // 从 URL 上拿不到 token(随机),直接解析捕获页拿不到——改为从捕获页 HTML 提取 token。
      const captureResp = await fetch(capturedUrl!);
      const html = await captureResp.text();
      const tokenMatch = /token:\s*'([a-f0-9]+)'/.exec(html);
      expect(tokenMatch).not.toBeNull();
      const token = tokenMatch![1]!;

      const form = new URLSearchParams({ token, cookies: "_pixiv_session=smoke-cookie; __csrf=abc" });
      const doneResp = await fetch(doneUrl.toString().replace("token=", `token=${token}`), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      expect(doneResp.status).toBe(200);

      const result = await loginPromise;
      expect(result.saved).toBe(true);
      expect(existsSync(authPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
