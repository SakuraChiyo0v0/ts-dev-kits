import { beforeEach, describe, expect, it, vi } from "vitest";
import https from "node:https";
import { acquireCookie, resolveConfig } from "../src/session.js";
import { createMemoryCookieStore } from "../src/cookie-store.js";
import { UgAppError, UgAppErrorCode } from "../src/errors.js";
import { MockServer, genRsaPem, pushLoginFlow, TEST_CONFIG } from "./helpers/mock-https.js";

vi.mock("node:https", () => ({ default: { request: vi.fn() } }));

describe("session 登录链路", () => {
  const server = new MockServer();

  beforeEach(() => {
    server.clear();
    server.install(vi.mocked(https.request));
  });

  it("完整登录链路拿到 ugreen-proxy-token 并写入缓存", async () => {
    pushLoginFlow(server, "cookie-abc");
    const store = createMemoryCookieStore();
    const cfg = resolveConfig(TEST_CONFIG);
    const cookie = await acquireCookie(cfg, store);

    expect(cookie).toBe("ugreen-proxy-token=cookie-abc");
    expect(store.get()).toMatchObject({ cookie: "ugreen-proxy-token=cookie-abc" });
    // 6 步 = check / login / onceToken / auth
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /ugreen/v1/verify/check",
      "POST /ugreen/v1/verify/login",
      "GET /ugreen/v1/gateway/proxy/onceToken?proxy_id=fcbab9b4f9a92a3aa980",
      "GET /api/ugreen/auth?token=ot-token",
    ]);
  });

  it("缓存有效期内不再发请求", async () => {
    pushLoginFlow(server);
    const store = createMemoryCookieStore();
    const cfg = resolveConfig(TEST_CONFIG);
    await acquireCookie(cfg, store);
    const before = server.calls.length;
    const again = await acquireCookie(cfg, store);
    expect(server.calls.length).toBe(before);
    expect(again).toBe("ugreen-proxy-token=final-cookie-1");
  });

  it("缓存过期后重新登录", async () => {
    pushLoginFlow(server, "cookie-new");
    const store = createMemoryCookieStore();
    const cfg = resolveConfig({ ...TEST_CONFIG, cookieTtlMs: 1000 });
    store.set("ugreen-proxy-token=stale", Date.now() - 2000);
    const cookie = await acquireCookie(cfg, store);
    expect(cookie).toBe("ugreen-proxy-token=cookie-new");
    expect(server.calls).toHaveLength(4); // 走了完整登录链路，而非命中缓存
  });

  it("预检缺 x-rsa-token 抛 LOGIN", async () => {
    server.push(() => ({ status: 200, headers: {}, body: "" }));
    const cfg = resolveConfig(TEST_CONFIG);
    await expect(acquireCookie(cfg, createMemoryCookieStore())).rejects.toMatchObject({
      name: "UgAppError",
      code: UgAppErrorCode.LOGIN,
    });
  });

  it("登录失败抛 AUTHENTICATION", async () => {
    const pem = genRsaPem();
    server.push(() => ({ status: 200, headers: { "x-rsa-token": Buffer.from(pem, "utf8").toString("base64") }, body: "" }));
    server.push(() => ({ status: 200, body: JSON.stringify({ code: 500, msg: "密码错误" }) }));
    const cfg = resolveConfig(TEST_CONFIG);
    await expect(acquireCookie(cfg, createMemoryCookieStore())).rejects.toMatchObject({
      name: "UgAppError",
      code: UgAppErrorCode.AUTHENTICATION,
    });
  });

  it("网关认证页拿不到 token 抛 LOGIN", async () => {
    const pem = genRsaPem();
    server.push(() => ({ status: 200, headers: { "x-rsa-token": Buffer.from(pem, "utf8").toString("base64") }, body: "" }));
    server.push(() => ({
      status: 200,
      headers: { "set-cookie": ["token=ug-token; Path=/"] },
      body: JSON.stringify({ code: 200, data: { token: "t", public_key: Buffer.from(pem, "utf8").toString("base64") } }),
    }));
    server.push(() => ({ status: 200, body: JSON.stringify({ code: 200, data: { token: "ot" } }) }));
    server.push(() => ({ status: 200, body: "<html>no cookie here</html>" }));
    const cfg = resolveConfig(TEST_CONFIG);
    await expect(acquireCookie(cfg, createMemoryCookieStore())).rejects.toMatchObject({
      name: "UgAppError",
      code: UgAppErrorCode.LOGIN,
    });
  });
});


