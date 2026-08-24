/**
 * 扫码登录流程测试 —— mock 服务器真实协议路径。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { xiaoheiheQrAdapter, buildTokenId, buildCredentials } from "../src/api/qrcode.js";
import { startMockServer } from "./helpers/mock-server.js";

let server: { baseUrl: string; close: () => Promise<void> };
let baseUrl: string;

beforeAll(async () => {
  server = await startMockServer();
  baseUrl = server.baseUrl;
});

afterAll(async () => {
  await server.close();
});

describe("xiaoheiheQrAdapter", () => {
  it("generateKey 返回二维码 URL", async () => {
    const adapter = xiaoheiheQrAdapter({ baseUrl });
    const { key, url } = await adapter.generateKey(fetch);
    expect(key).toContain("/account/qr_login/");
    expect(url).toBe(key);
  });

  it("pollStatus 轮询到成功并提取凭证(前两次 waiting,第三次 success)", async () => {
    const adapter = xiaoheiheQrAdapter({ baseUrl });
    const { key } = await adapter.generateKey(fetch);

    const first = await adapter.pollStatus(key, fetch);
    expect(first.state).toBe("waiting");

    const second = await adapter.pollStatus(key, fetch);
    expect(second.state).toBe("waiting");

    const third = await adapter.pollStatus(key, fetch);
    expect(third.state).toBe("success");
    expect(third.credentials).toBeDefined();
    const credentials = third.credentials as {
      cookie: string;
      heyboxId: string;
      time: number;
    };
    expect(credentials.heyboxId).toBe("123456");
    expect(credentials.cookie).toContain("token_a=value_a");
    expect(credentials.cookie).toContain("token_b=value_b");
    expect(credentials.cookie).toContain("x_xhh_tokenid=");
    expect(typeof credentials.time).toBe("number");
  });

  it("过期二维码返回 expired", async () => {
    const adapter = xiaoheiheQrAdapter({ baseUrl });
    const result = await adapter.pollStatus("https://api.xiaoheihe.cn/account/qr_login/?key=nope", fetch);
    expect(result.state).toBe("expired");
  });

  it("serialize/deserialize 往返", () => {
    const adapter = xiaoheiheQrAdapter();
    const credentials = {
      cookie: "token_a=value_a;x_xhh_tokenid=abc",
      heyboxId: "123456",
      time: 1700000000,
    };
    const payload = adapter.serialize(credentials, "2026-08-24T00:00:00.000Z");
    expect(payload.platform).toBe("xiaoheihe");
    const restored = adapter.deserialize(payload);
    expect(restored).toEqual(credentials);
  });

  it("deserialize 拒绝损坏载荷", () => {
    const adapter = xiaoheiheQrAdapter();
    expect(
      adapter.deserialize({ platform: "xiaoheihe", credentials: { cookie: "" }, savedAt: "x" }),
    ).toBeNull();
    expect(
      adapter.deserialize({ platform: "xiaoheihe", credentials: {}, savedAt: "x" }),
    ).toBeNull();
  });
});

describe("buildTokenId", () => {
  it("返回标准 base64,解码后 65 字节(4×MD5 + NUL)", () => {
    const token = buildTokenId(1700000000);
    expect(token).toMatch(/^[A-Za-z0-9+/=]+$/);
    const decoded = Buffer.from(token, "base64");
    expect(decoded).toHaveLength(65);
    expect(decoded[64]).toBe(0);
  });

  it("同时间戳结果确定", () => {
    expect(buildTokenId(1700000000)).toBe(buildTokenId(1700000000));
  });
});

describe("buildCredentials", () => {
  it("从 Set-Cookie 提取 heyboxId 与凭证,追加 token", () => {
    const headers = new Headers();
    headers.append("set-cookie", "token_a=value_a; Path=/");
    headers.append("set-cookie", "user_heybox_id=999; Path=/");
    headers.append("set-cookie", "token_b=value_b; Path=/");
    const credentials = buildCredentials(headers, 1700000000);
    expect(credentials).not.toBeNull();
    expect(credentials!.heyboxId).toBe("999");
    expect(credentials!.cookie).toContain("token_a=value_a");
    expect(credentials!.cookie).toContain("token_b=value_b");
    expect(credentials!.cookie).not.toContain("user_heybox_id=");
    expect(credentials!.cookie).toContain("x_xhh_tokenid=");
  });

  it("无 Set-Cookie 返回 null", () => {
    expect(buildCredentials(new Headers(), 1700000000)).toBeNull();
  });
});
