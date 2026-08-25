import { describe, expect, it } from "vitest";
import {
  AccountError,
  AuthStore,
  qrcodeLogin,
  type QrLoginAdapter,
} from "../src/index.js";

/** 假适配器:扫码状态机 waiting → scanned → success。 */
function fakeAdapter(): QrLoginAdapter {
  let pollCount = 0;
  return {
    platform: "fake-platform",
    async generateKey() {
      return { key: "k1", url: "https://fake/scan?key=k1" };
    },
    async pollStatus() {
      pollCount += 1;
      if (pollCount === 1) {
        return { state: "waiting", message: "等待扫码" };
      }
      if (pollCount === 2) {
        return { state: "scanned", message: "已扫码" };
      }
      return {
        state: "success",
        message: "登录成功",
        credentials: { token: "t1", uid: 42 },
      };
    },
    serialize(credentials, savedAt) {
      return { platform: this.platform, credentials, savedAt };
    },
    deserialize(payload) {
      return typeof payload.credentials?.token === "string" ? payload.credentials : null;
    },
  };
}

describe("qrcodeLogin", () => {
  it("collects credentials through adapter state machine", async () => {
    const statuses: string[] = [];
    const result = await qrcodeLogin({
      adapter: fakeAdapter(),
      autoOpenBrowser: false,
      pollIntervalMs: 1,
      timeoutMs: 5000,
      onStatus: (s) => statuses.push(s.state),
    });
    expect(result.credentials).toEqual({ token: "t1", uid: 42 });
    expect(result.saved).toBe(false);
    expect(statuses).toContain("waiting");
    expect(statuses).toContain("scanned");
    expect(statuses).toContain("success");
  });

  it("emits QR code image via onQrCode callback", async () => {
    const qrCodes: string[] = [];
    await qrcodeLogin({
      adapter: fakeAdapter(),
      autoOpenBrowser: false,
      pollIntervalMs: 1,
      timeoutMs: 5000,
      onQrCode: (dataUrl) => qrCodes.push(dataUrl),
    });
    expect(qrCodes.length).toBe(1);
    expect(qrCodes[0]!).toMatch(/^data:image\/png;base64,/u);
  });

  it("persists to store when provided", async () => {
    const adapter = fakeAdapter();
    const storePath = `${process.env.TEMP ?? "/tmp"}/account-qr-${Date.now()}.json`;
    const store = new AuthStore({ platform: "fake-platform", path: storePath });
    try {
      const result = await qrcodeLogin({
        adapter,
        store,
        autoOpenBrowser: false,
        pollIntervalMs: 1,
        timeoutMs: 5000,
      });
      expect(result.saved).toBe(true);
      const loaded = await store.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.credentials).toEqual({ token: "t1", uid: 42 });
      expect(loaded!.platform).toBe("fake-platform");
    } finally {
      await store.clear();
    }
  });

  it("rethrows adapter AccountError", async () => {
    const adapter: QrLoginAdapter = {
      platform: "fake",
      async generateKey() {
        throw new AccountError("API_ERROR", "generate failed");
      },
      async pollStatus() {
        return { state: "waiting", message: "" };
      },
      serialize(credentials, savedAt) {
        return { platform: "fake", credentials, savedAt };
      },
      deserialize(payload) {
        return payload.credentials;
      },
    };
    await expect(
      qrcodeLogin({ adapter, autoOpenBrowser: false, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "API_ERROR" });
  });

  it("times out when adapter never succeeds", async () => {
    const adapter: QrLoginAdapter = {
      platform: "fake",
      async generateKey() {
        return { key: "k", url: "https://fake" };
      },
      async pollStatus() {
        return { state: "waiting", message: "等待" };
      },
      serialize(credentials, savedAt) {
        return { platform: "fake", credentials, savedAt };
      },
      deserialize(payload) {
        return payload.credentials;
      },
    };
    await expect(
      qrcodeLogin({ adapter, autoOpenBrowser: false, pollIntervalMs: 1, timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  });
});
