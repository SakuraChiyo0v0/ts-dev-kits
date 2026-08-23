import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SteamHttpTransport } from "../src/http.js";
import { startMockSteamServer, type MockSteamServer } from "./helpers/mock-steam-server.js";

describe("SteamHttpTransport", () => {
  let server: MockSteamServer;

  beforeEach(async () => {
    server = await startMockSteamServer();
    server.resetHits();
  });

  afterEach(async () => {
    await server.close();
  });

  it("withKey 注入 X-WebAPI-Key 头", async () => {
    const transport = new SteamHttpTransport({ apiKey: "TEST_KEY", baseUrls: server.baseUrls });
    const result = await transport.request<{ headers: { "x-webapi-key": string | null } }>({
      host: "api",
      path: "/echo",
      withKey: true,
    });
    expect(result.headers["x-webapi-key"]).toBe("TEST_KEY");
  });

  it("withKey 但未配置 key → CONFIGURATION", async () => {
    const transport = new SteamHttpTransport({ baseUrls: server.baseUrls });
    await expect(
      transport.request({ host: "api", path: "/echo", withKey: true }),
    ).rejects.toMatchObject({ code: "CONFIGURATION" });
  });

  it("429 退避重试后成功", async () => {
    const transport = new SteamHttpTransport({ baseUrls: server.baseUrls });
    const result = await transport.request<{ ok: boolean }>({ host: "api", path: "/rate-limit-once" });
    expect(result.ok).toBe(true);
    expect(server.hits("/rate-limit-once")).toBe(2);
  });

  it("429 重试耗尽 → RATE_LIMIT 带 retryAfterSeconds", async () => {
    const transport = new SteamHttpTransport({ baseUrls: server.baseUrls, maxRetries: 1 });
    await expect(
      transport.request({ host: "api", path: "/rate-limit-always" }),
    ).rejects.toMatchObject({ code: "RATE_LIMIT", retryAfterSeconds: 2 });
  });

  it("GET 命中 TTL 缓存(服务端只收到一次请求)", async () => {
    const transport = new SteamHttpTransport({
      baseUrls: server.baseUrls,
      cache: { enabled: true, ttlMs: 60_000 },
    });
    const r1 = await transport.request<{ value: number }>({
      host: "api",
      path: "/cacheable",
      params: { v: 42 },
    });
    const r2 = await transport.request<{ value: number }>({
      host: "api",
      path: "/cacheable",
      params: { v: 42 },
    });
    expect(r1.value).toBe(42);
    expect(r2.value).toBe(42);
    expect(server.hits("/cacheable")).toBe(1);
  });

  it("noCache 绕过缓存", async () => {
    const transport = new SteamHttpTransport({ baseUrls: server.baseUrls, cache: { ttlMs: 60_000 } });
    await transport.request({ host: "api", path: "/cacheable", params: { v: 1 } });
    await transport.request({ host: "api", path: "/cacheable", params: { v: 1 }, noCache: true });
    expect(server.hits("/cacheable")).toBe(2);
  });

  it("withCookies 附加会话 cookie", async () => {
    const transport = new SteamHttpTransport({
      baseUrls: server.baseUrls,
      cookie: "sessionid=abc123; steamLoginSecure=xyz",
    });
    const result = await transport.request<{ headers: { cookie: string | null } }>({
      host: "community",
      path: "/echo",
      withCookies: true,
    });
    expect(result.headers.cookie).toBe("sessionid=abc123; steamLoginSecure=xyz");
  });

  it("超时 → TIMEOUT", async () => {
    const transport = new SteamHttpTransport({ baseUrls: server.baseUrls, timeoutMs: 100 });
    await expect(transport.request({ host: "api", path: "/slow" })).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("proxy 配置注入 dispatcher", async () => {
    let captured: { url: unknown; init: { dispatcher?: unknown } | undefined } | undefined;
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      captured = { url, init: init as { dispatcher?: unknown } | undefined };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const transport = new SteamHttpTransport({
      proxy: "http://127.0.0.1:8888",
      fetchImpl,
      baseUrls: server.baseUrls,
    });
    await transport.request({ host: "api", path: "/echo" });
    expect(captured?.init?.dispatcher).toBeDefined();
  });

  it("401 → AUTH_EXPIRED", async () => {
    const transport = new SteamHttpTransport({ apiKey: "WRONG_KEY", baseUrls: server.baseUrls });
    await expect(
      transport.request({ host: "api", path: "/ISteamWebAPIUtil/GetSupportedAPIList/v1/", withKey: true }),
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED", statusCode: 401 });
  });

  it("404 → NOT_FOUND", async () => {
    const transport = new SteamHttpTransport({ baseUrls: server.baseUrls });
    await expect(transport.request({ host: "api", path: "/nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
