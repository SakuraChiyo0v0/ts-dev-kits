import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createConfigStore,
  createEncryptedConfigStore,
  createWebdavClient,
  WebdavErrorCode,
} from "../src/index.js";
import { startTestWebdavServer, type TestWebdavServer } from "./helpers/webdav-test-server.js";

const TEST_KEY = "0123456789abcdef0123456789abcdef"; // 32 字节 hex

describe("EncryptedConfigStore 加密存储(AES-256-GCM)", () => {
  let srv: TestWebdavServer;
  let client: ReturnType<typeof createWebdavClient>;

  beforeAll(async () => {
    srv = await startTestWebdavServer();
    client = createWebdavClient({ url: srv.url, username: srv.username, password: srv.password });
    await client.mkdir("/configs");
  });

  afterAll(async () => {
    await srv.stop();
  });

  it("save → load 往返,内容正确", async () => {
    const store = createEncryptedConfigStore({ client, basePath: "/configs", key: TEST_KEY });
    await store.save("secrets.json", { cookie: "SID=abc123", token: "sk-secret" });
    expect(await store.load<{ cookie: string; token: string }>("secrets.json")).toEqual({
      cookie: "SID=abc123",
      token: "sk-secret",
    });
  });

  it("云端存储的是密文,不含明文", async () => {
    const store = createEncryptedConfigStore({ client, basePath: "/configs", key: TEST_KEY });
    await store.save("plaincheck.json", { password: "super-secret-value" });
    // 用普通 ConfigStore 直接读,拿到的是密文,绝不能含明文
    const plain = createConfigStore({ client, basePath: "/configs", format: "text" });
    const raw = await plain.load<string>("plaincheck.json");
    // 密文 JSON 结构:含格式版本 v 与 iv/tag/data 字段,且不含明文
    expect(raw).toContain('"data"');
    expect(raw).not.toContain("super-secret-value");
    expect(raw).not.toContain("password");
  });

  it("密钥错误 → DECRYPTION", async () => {
    const store = createEncryptedConfigStore({ client, basePath: "/configs", key: TEST_KEY });
    await store.save("wrongkey.json", { a: 1 });
    const wrong = createEncryptedConfigStore({
      client,
      basePath: "/configs",
      key: "fedcba9876543210fedcba9876543210",
    });
    await expect(wrong.load("wrongkey.json")).rejects.toMatchObject({ code: WebdavErrorCode.DECRYPTION });
  });

  it("缺密钥 → VALIDATION", () => {
    const prev = process.env.WEBDAV_CONFIG_KEY;
    delete process.env.WEBDAV_CONFIG_KEY;
    try {
      expect(() => createEncryptedConfigStore({ client, basePath: "/configs" })).toThrowError(
        expect.objectContaining({ code: WebdavErrorCode.VALIDATION }),
      );
    } finally {
      if (prev !== undefined) process.env.WEBDAV_CONFIG_KEY = prev;
    }
  });

  it("密钥可从环境变量读取", async () => {
    const prev = process.env.WEBDAV_CONFIG_KEY;
    process.env.WEBDAV_CONFIG_KEY = TEST_KEY;
    try {
      const store = createEncryptedConfigStore({ client, basePath: "/configs" });
      await store.save("envkey.json", { from: "env" });
      expect(await store.load<{ from: string }>("envkey.json")).toEqual({ from: "env" });
    } finally {
      if (prev !== undefined) process.env.WEBDAV_CONFIG_KEY = prev;
    }
  });

  it("任意字符串密钥自动派生,备份也是密文", async () => {
    const store = createEncryptedConfigStore({ client, basePath: "/configs", key: "my-passphrase" });
    await store.save("passphrase.json", { v: 1 });
    await store.save("passphrase.json", { v: 2 });
    expect(await store.load<{ v: number }>("passphrase.json")).toEqual({ v: 2 });
    // 备份文件同样加密
    const plain = createConfigStore({ client, basePath: "/configs", format: "text" });
    const bak = await plain.load<string>("passphrase.json.bak.1");
    expect(bak).not.toContain('{"v":1}'); // 明文序列化特征不应出现在密文备份里
  });
});
