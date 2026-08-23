import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStore } from "@sakurachiyo0v0/account";
import { createSteamClient, type SteamClient } from "../src/client.js";
import {
  startMockSteamServer,
  MOCK_GUARD_CODE,
  MOCK_PASSWORD,
  TEST_ID64,
  type MockSteamServer,
} from "./helpers/mock-steam-server.js";

/** 密码登录用例:mock 密码必须与加密传输一致(RSA 往返)。 */
describe("P2 登录态", () => {
  let server: MockSteamServer;
  let client: SteamClient;
  let tempDir: string;

  beforeEach(async () => {
    server = await startMockSteamServer();
    tempDir = mkdtempSync(join(tmpdir(), "steam-auth-test-"));
    client = createSteamClient({
      apiKey: "TEST_KEY",
      baseUrls: server.baseUrls,
      sessionPath: join(tempDir, "auth.json"),
    });
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("TOTP", () => {
    it("RFC6238 SHA1 标准向量(8 位)", async () => {
      const { generateTotpCode } = await import("../src/auth/totp.js");
      // secret = base32("12345678901234567890"),时间步 30s,时间 59s → 8 位 94287082
      const code = generateTotpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", {
        digits: 8,
        timestamp: 59_000,
      });
      expect(code).toBe("94287082");
    });

    it("Steam 默认 5 位 / 30 秒步长,确定性", async () => {
      const { generateTotpCode } = await import("../src/auth/totp.js");
      const a = generateTotpCode("AAAAAAAAAAAAAAAA", { timestamp: 1700000000000 });
      const b = generateTotpCode("AAAAAAAAAAAAAAAA", { timestamp: 1700000000000 });
      const c = generateTotpCode("AAAAAAAAAAAAAAAA", { timestamp: 1700000030000 });
      expect(a).toBe(b);
      expect(a).toMatch(/^\d{5}$/);
      expect(c).not.toBe(a); // 跨时间步变化
    });
  });

  describe("密码登录", () => {
    it("邮箱验证码:need_code → 提交正确码 → 成功并注入 cookie", async () => {
      let requested = 0;
      const result = await client.auth.loginWithPassword({
        accountName: "needs2fa",
        password: MOCK_PASSWORD,
        onNeedCode: async (info) => {
          expect(info.method).toBe("otp");
          requested += 1;
          return MOCK_GUARD_CODE;
        },
      });
      expect(requested).toBe(1);
      expect(result.saved).toBe(true);
      const credentials = result.credentials as {
        accountName?: string;
        steamid?: string;
        accessToken?: string;
        refreshToken?: string;
        cookies?: string;
      };
      expect(credentials.steamid).toBe(TEST_ID64);
      expect(credentials.accessToken).toMatch(/^access-/);
      expect(credentials.refreshToken).toMatch(/^eyJ/);
      expect(credentials.cookies).toContain("steamLoginSecure");
      // 登录后 cookie 已注入传输层。
      expect(client.hasSession).toBe(true);
      expect(client.auth.status().loggedIn).toBe(true);
    });

    it("TOTP 验证码路径(totp2fa)", async () => {
      const result = await client.auth.loginWithPassword({
        accountName: "totp2fa",
        password: MOCK_PASSWORD,
        onNeedCode: async (info) => {
          expect(info.method).toBe("totp");
          return MOCK_GUARD_CODE;
        },
      });
      expect(result.saved).toBe(true);
    });

    it("totpSharedSecret 自动填充(码不匹配 → 骨架重试耗尽后失败)", async () => {
      // 自动生成的 TOTP 不是 mock 的固定码,重试耗尽后以 TWO_FACTOR_FAILED 收场。
      await expect(
        client.auth.loginWithPassword({
          accountName: "totp2fa",
          password: MOCK_PASSWORD,
          totpSharedSecret: "AAAAAAAAAAAAAAAA",
        }),
      ).rejects.toMatchObject({ code: "TWO_FACTOR_FAILED" });
      expect(client.auth.status().loggedIn).toBe(false);
    });

    it("验证码错误 → 重试成功后完成", async () => {
      const attempts: string[] = [];
      const result = await client.auth.loginWithPassword({
        accountName: "needs2fa",
        password: MOCK_PASSWORD,
        onNeedCode: async () => {
          attempts.push(String(attempts.length));
          return attempts.length === 1 ? "99999" : MOCK_GUARD_CODE;
        },
      });
      expect(attempts).toHaveLength(2);
      expect(result.saved).toBe(true);
      expect(client.hasSession).toBe(true);
    });

    it("密码错误 → INVALID_CREDENTIALS", async () => {
      await expect(
        client.auth.loginWithPassword({
          accountName: "needs2fa",
          password: "wrong-password",
          onNeedCode: async () => MOCK_GUARD_CODE,
        }),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    });

    it("设备确认:无验证码路径,轮询到成功", async () => {
      const result = await client.auth.loginWithPassword({
        accountName: "device2fa",
        password: MOCK_PASSWORD,
      });
      expect(result.saved).toBe(true);
      expect(client.hasSession).toBe(true);
    });
  });

  describe("二维码登录", () => {
    it("扫码流程:waiting → scanned → success", async () => {
      const states: string[] = [];
      const result = await client.auth.loginWithQr({
        autoOpenBrowser: false,
        pollIntervalMs: 50,
        timeoutMs: 10_000,
        onStatus: (status) => states.push(status.state),
      });
      expect(result.saved).toBe(true);
      expect(states).toContain("scanned");
      expect(states[states.length - 1]).toBe("success");
      expect(client.hasSession).toBe(true);
      const credentials = result.credentials as { cookies?: string };
      expect(credentials.cookies).toContain("steamLoginSecure");
    });
  });

  describe("会话管理", () => {
    it("importCookies → status.loggedIn + cookie 注入", async () => {
      await client.auth.importCookies("steamLoginSecure=abc%7C%7Ctok; sessionid=x123");
      expect(client.auth.status().loggedIn).toBe(true);
      expect(client.hasSession).toBe(true);
    });

    it("持久化:重新创建客户端(同 sessionPath)恢复登录态", async () => {
      await client.auth.loginWithPassword({
        accountName: "needs2fa",
        password: MOCK_PASSWORD,
        onNeedCode: async () => MOCK_GUARD_CODE,
      });
      await client.close();

      const client2 = createSteamClient({
        apiKey: "TEST_KEY",
        baseUrls: server.baseUrls,
        sessionPath: join(tempDir, "auth.json"),
      });
      expect(client2.auth.status().loggedIn).toBe(true);
      expect(client2.auth.status().steamid).toBe(TEST_ID64);
      // 持久化会话回填传输层 cookie:新实例可直接调用需登录态的方法。
      const listings = await client2.market.getMyListings();
      expect(listings.total_count).toBe(1);

      // checkSession 用 refresh_token 实际续期验证。
      await expect(client2.auth.checkSession()).resolves.toBe(true);
      await client2.close();
    });

    it("checkSession 无登录态 → false", async () => {
      await expect(client.auth.checkSession()).resolves.toBe(false);
    });

    it("refreshCookies 重新拉取 web cookie", async () => {
      await client.auth.importCookies("steamLoginSecure=old; sessionid=old", {
        save: true,
      });
      // 无 refresh_token 时抛 LOGIN_REQUIRED。
      await expect(client.auth.refreshCookies()).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    });

    it("logout 清除传输层 cookie 与存储", async () => {
      await client.auth.loginWithPassword({
        accountName: "needs2fa",
        password: MOCK_PASSWORD,
        onNeedCode: async () => MOCK_GUARD_CODE,
      });
      expect(client.hasSession).toBe(true);
      await client.auth.logout();
      expect(client.hasSession).toBe(false);
      expect(client.auth.status().loggedIn).toBe(false);
      // 存储文件已删除。
      const store = new AuthStore({ platform: "steam", path: join(tempDir, "auth.json") });
      expect(store.exists()).toBe(false);
    });
  });
});
