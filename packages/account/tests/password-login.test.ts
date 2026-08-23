import { describe, expect, it } from "vitest";
import {
  AccountError,
  AuthStore,
  passwordLogin,
  type PasswordLoginAdapter,
} from "../src/index.js";

/** 假适配器:密码 → 需要 2FA → 验证码正确则成功。 */
function fakeAdapter(): PasswordLoginAdapter {
  return {
    platform: "fake-password",
    async login(credentials) {
      if (credentials.username !== "alice" || credentials.password !== "pw123") {
        throw new AccountError("INVALID_CREDENTIALS", "用户名或密码错误");
      }
      return {
        status: "need_code",
        challengeId: "ch-1",
        method: "otp",
        message: "请输入邮箱验证码",
      };
    },
    async verifyCode(_step, code) {
      if (code === "123456") {
        return { status: "success", credentials: { authCookie: "cookie-abc" } };
      }
      return {
        status: "need_code",
        challengeId: "ch-1",
        method: "otp",
        message: "验证码错误,请重试",
      };
    },
    serialize(credentials, savedAt) {
      return { platform: this.platform, credentials, savedAt };
    },
    deserialize(payload) {
      return typeof payload.credentials?.authCookie === "string"
        ? payload.credentials
        : null;
    },
  };
}

describe("passwordLogin", () => {
  it("collects credentials through password + 2FA flow", async () => {
    const statuses: string[] = [];
    const result = await passwordLogin({
      adapter: fakeAdapter(),
      username: "alice",
      password: "pw123",
      onNeedCode: () => "123456",
      onStatus: (s) => statuses.push(s.state),
    });
    expect(result.credentials).toEqual({ authCookie: "cookie-abc" });
    expect(result.saved).toBe(false);
    expect(statuses).toContain("submitting");
    expect(statuses).toContain("need_code");
    expect(statuses).toContain("success");
  });

  it("persists to store when provided", async () => {
    const adapter = fakeAdapter();
    const storePath = `${process.env.TEMP ?? "/tmp"}/account-pw-${Date.now()}.json`;
    const store = new AuthStore({ platform: "fake-password", path: storePath });
    try {
      const result = await passwordLogin({
        adapter,
        username: "alice",
        password: "pw123",
        store,
        onNeedCode: () => "123456",
      });
      expect(result.saved).toBe(true);
      const loaded = await store.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.credentials).toEqual({ authCookie: "cookie-abc" });
      expect(loaded!.platform).toBe("fake-password");
    } finally {
      await store.clear();
    }
  });

  it("rethrows adapter AccountError (invalid credentials)", async () => {
    await expect(
      passwordLogin({
        adapter: fakeAdapter(),
        username: "bob",
        password: "wrong",
        onNeedCode: () => "123456",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("throws TWO_FACTOR_REQUIRED when no code source", async () => {
    await expect(
      passwordLogin({ adapter: fakeAdapter(), username: "alice", password: "pw123" }),
    ).rejects.toMatchObject({ code: "TWO_FACTOR_REQUIRED" });
  });

  it("throws TWO_FACTOR_FAILED after max attempts", async () => {
    await expect(
      passwordLogin({
        adapter: fakeAdapter(),
        username: "alice",
        password: "pw123",
        onNeedCode: () => "000000",
        maxCodeAttempts: 2,
      }),
    ).rejects.toMatchObject({ code: "TWO_FACTOR_FAILED" });
  });

  it("throws TWO_FACTOR_FAILED when code is empty (cancelled)", async () => {
    await expect(
      passwordLogin({
        adapter: fakeAdapter(),
        username: "alice",
        password: "pw123",
        onNeedCode: () => "",
      }),
    ).rejects.toMatchObject({ code: "TWO_FACTOR_FAILED" });
  });
});
