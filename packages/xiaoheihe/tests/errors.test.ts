/**
 * 错误分支测试 —— 风控识别 / HTTP 状态归类 / 业务状态异常。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createXiaoheiheClient } from "../src/client.js";
import { XiaoheiheError } from "../src/errors.js";
import { XiaoheiheHttpTransport } from "../src/transport.js";
import { startMockServer } from "./helpers/mock-server.js";

let server: { baseUrl: string; close: () => Promise<void> };

beforeAll(async () => {
  server = await startMockServer();
});

afterAll(async () => {
  await server.close();
});

describe("风控识别", () => {
  it("响应体含 captcha → CAPTCHA", async () => {
    const client = createXiaoheiheClient({ baseUrl: server.baseUrl, cookie: "c=1" });
    // mock 的 feeds?captcha=1 由传输层自动加公共参数触发不了,改用伪造 fetch。
    const transport = new XiaoheiheHttpTransport({
      fetchImpl: async () =>
        new Response("<html>captcha verify ticket</html>", { status: 200 }),
    });
    await expect(
      transport.request<unknown>({ path: "/bbs/app/feeds" }),
    ).rejects.toMatchObject({ code: "CAPTCHA" });
  });

  it("status=show_captcha → CAPTCHA", async () => {
    const transport = new XiaoheiheHttpTransport({
      fetchImpl: async () =>
        new Response(JSON.stringify({ status: "show_captcha", msg: "verify" }), { status: 200 }),
    });
    await expect(
      transport.request<unknown>({ path: "/bbs/app/feeds" }),
    ).rejects.toMatchObject({ code: "CAPTCHA" });
  });

  it("status=error_captcha → CAPTCHA", async () => {
    const transport = new XiaoheiheHttpTransport({
      fetchImpl: async () =>
        new Response(JSON.stringify({ status: "error_captcha" }), { status: 200 }),
    });
    await expect(
      transport.request<unknown>({ path: "/bbs/app/feeds" }),
    ).rejects.toMatchObject({ code: "CAPTCHA" });
  });
});

describe("HTTP 状态归类", () => {
  it("401 → AUTH_EXPIRED", async () => {
    const transport = new XiaoheiheHttpTransport({
      fetchImpl: async () =>
        new Response(JSON.stringify({ status: "error" }), { status: 401 }),
    });
    await expect(
      transport.request<unknown>({ path: "/bbs/app/user/message" }),
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
  });

  it("429 → RATE_LIMIT(带 retry-after)", async () => {
    const transport = new XiaoheiheHttpTransport({
      fetchImpl: async () =>
        new Response(JSON.stringify({ status: "error" }), {
          status: 429,
          headers: { "retry-after": "30" },
        }),
    });
    await expect(
      transport.request<unknown>({ path: "/bbs/app/feeds" }),
    ).rejects.toMatchObject({ code: "RATE_LIMIT", retryAfterSeconds: 30 });
  });

  it("非 2xx → API_ERROR", async () => {
    const transport = new XiaoheiheHttpTransport({
      fetchImpl: async () =>
        new Response(JSON.stringify({ status: "error" }), { status: 500 }),
    });
    await expect(
      transport.request<unknown>({ path: "/bbs/app/feeds" }),
    ).rejects.toMatchObject({ code: "API_ERROR" });
  });
});

describe("业务状态异常", () => {
  it("status 非 ok 且非风控 → API_ERROR(带 serverMsg)", async () => {
    const transport = new XiaoheiheHttpTransport({
      fetchImpl: async () =>
        new Response(JSON.stringify({ status: "forbidden", msg: "账号异常" }), { status: 200 }),
    });
    await expect(
      transport.request<unknown>({ path: "/bbs/app/feeds" }),
    ).rejects.toMatchObject({ code: "API_ERROR", serverMsg: "账号异常" });
  });

  it("fetch 网络错误 → NETWORK", async () => {
    const transport = new XiaoheiheHttpTransport({
      fetchImpl: async () => {
        throw new TypeError("fetch failed: ENOTFOUND api.xiaoheihe.cn");
      },
    });
    await expect(
      transport.request<unknown>({ path: "/bbs/app/feeds" }),
    ).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("超时 → TIMEOUT", async () => {
    const transport = new XiaoheiheHttpTransport({
      timeoutMs: 50,
      fetchImpl: (_url, init) =>
        new Promise((resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });
    await expect(
      transport.request<unknown>({ path: "/bbs/app/feeds" }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("XiaoheiheError 基本性质", () => {
  it("携带 code 与脱敏消息", () => {
    const error = new XiaoheiheError("LOGIN_REQUIRED", "未登录,请先扫码登录");
    expect(error.code).toBe("LOGIN_REQUIRED");
    expect(error.name).toBe("XiaoheiheError");
    expect(error.message).not.toContain("cookie");
  });
});
