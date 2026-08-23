import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AccountError,
  passwordLogin,
} from "@sakurachiyo0v0/account";
import {
  createVrchatClient,
  VrchatError,
  VrchatPasswordAdapter,
} from "../src/index.js";
import { VrchatHttpTransport } from "../src/transport.js";
import { MockVrchatServer } from "./helpers/mock-vrchat-server.js";

let server: MockVrchatServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("VrchatPasswordAdapter (真实 HTTP 协议路径)", () => {
  it("登录成功(无 2FA)并注入 cookie", async () => {
    server = new MockVrchatServer();
    const baseUrl = await server.start();
    const transport = new VrchatHttpTransport({ baseUrl });
    const adapter = new VrchatPasswordAdapter({ transport });

    const result = await passwordLogin({
      adapter,
      username: "alice",
      password: "pw123",
    });
    expect(result.credentials).toEqual({ authCookie: "auth=mock-auth-cookie-123" });
    expect(transport.cookie).toBe("auth=mock-auth-cookie-123");
  });

  it("登录失败(密码错误)抛 INVALID_CREDENTIALS", async () => {
    server = new MockVrchatServer();
    const baseUrl = await server.start();
    const transport = new VrchatHttpTransport({ baseUrl });
    const adapter = new VrchatPasswordAdapter({ transport });

    await expect(
      passwordLogin({ adapter, username: "alice", password: "wrong" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("2FA 流程:需要验证码 → 正确码成功", async () => {
    server = new MockVrchatServer({ requireTwoFactor: true });
    const baseUrl = await server.start();
    const transport = new VrchatHttpTransport({ baseUrl });
    const adapter = new VrchatPasswordAdapter({ transport });

    const result = await passwordLogin({
      adapter,
      username: "alice",
      password: "pw123",
      onNeedCode: () => "123456",
    });
    expect(result.credentials).toEqual({ authCookie: "auth=authcookie_mock_interim" });
    expect(transport.cookie).toBe("auth=authcookie_mock_interim");
  });

  it("2FA 流程:错误码重试后成功", async () => {
    server = new MockVrchatServer({ requireTwoFactor: true });
    const baseUrl = await server.start();
    const transport = new VrchatHttpTransport({ baseUrl });
    const adapter = new VrchatPasswordAdapter({ transport });
    let attempt = 0;

    const result = await passwordLogin({
      adapter,
      username: "alice",
      password: "pw123",
      onNeedCode: () => {
        attempt += 1;
        return attempt === 1 ? "000000" : "123456";
      },
    });
    expect(result.credentials).toEqual({ authCookie: "auth=authcookie_mock_interim" });
    expect(attempt).toBe(2);
  });

  it("2FA 多次错误抛 TWO_FACTOR_FAILED", async () => {
    server = new MockVrchatServer({ requireTwoFactor: true });
    const baseUrl = await server.start();
    const transport = new VrchatHttpTransport({ baseUrl });
    const adapter = new VrchatPasswordAdapter({ transport });

    await expect(
      passwordLogin({
        adapter,
        username: "alice",
        password: "pw123",
        onNeedCode: () => "000000",
        maxCodeAttempts: 2,
      }),
    ).rejects.toMatchObject({ code: "TWO_FACTOR_FAILED" });
  });
});

describe("VrchatHttpTransport 错误归类", () => {
  it("429 限流:自动退避后成功", async () => {
    server = new MockVrchatServer({ rateLimitConfigTimes: 1 });
    const baseUrl = await server.start();
    const transport = new VrchatHttpTransport({ baseUrl, maxRetries: 2 });
    const config = await transport.request<{ appName: string }>({
      method: "GET",
      path: "/config",
    });
    expect(config.appName).toBe("VRChat");
  });

  it("429 超限抛 RATE_LIMIT(带 retryAfterSeconds)", async () => {
    server = new MockVrchatServer({ rateLimitConfigTimes: 5 });
    const baseUrl = await server.start();
    const transport = new VrchatHttpTransport({ baseUrl, maxRetries: 1 });
    await expect(
      transport.request({ method: "GET", path: "/config" }),
    ).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });

  it("404 抛 NOT_FOUND", async () => {
    server = new MockVrchatServer();
    const baseUrl = await server.start();
    const transport = new VrchatHttpTransport({ baseUrl });
    transport.setCookie("auth=mock-auth-cookie-123");
    await expect(
      transport.request({ method: "GET", path: "/users/nonexistent" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("createVrchatClient 认证域", () => {
  it("未登录时 currentUser 抛 AUTH_EXPIRED(401)", async () => {
    server = new MockVrchatServer();
    const baseUrl = await server.start();
    const client = await createVrchatClient({ baseUrl });
    expect(client.isLoggedIn).toBe(false);
    await expect(client.auth.currentUser()).rejects.toBeInstanceOf(VrchatError);
    await client.close();
  });

  it("显式 cookie 登录后可查当前用户并登出", async () => {
    server = new MockVrchatServer();
    const baseUrl = await server.start();
    const client = await createVrchatClient({
      baseUrl,
      cookie: "auth=mock-auth-cookie-123",
    });
    expect(client.isLoggedIn).toBe(true);
    const me = await client.auth.currentUser();
    expect(me.username).toBe("alice");
    expect(await client.auth.checkSession()).toBe(true);

    const limits = await client.auth.getFavoriteLimits();
    expect(limits.avatar).toBe(100);

    await client.logout();
    expect(client.isLoggedIn).toBe(false);
    await client.close();
  });

  it("client.login 全流程(密码 + 2FA)后会话可用", async () => {
    server = new MockVrchatServer({ requireTwoFactor: true });
    const baseUrl = await server.start();
    const client = await createVrchatClient({ baseUrl });

    const result = await client.login({
      username: "alice",
      password: "pw123",
      onNeedCode: () => "123456",
    });
    expect(result.saved).toBe(false);
    expect(client.isLoggedIn).toBe(true);
    const me = await client.auth.currentUser();
    expect(me.username).toBe("alice");
    await client.close();
  });
});
