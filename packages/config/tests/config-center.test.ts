import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConfigStore, createWebdavClient, WebdavErrorCode } from "@sakurachiyo0v0/webdav";
import { createConfigCenter } from "../src/index.js";
import type { ConfigCenter } from "../src/index.js";
import { startTestWebdavServer, type TestWebdavServer } from "./helpers/webdav-test-server.js";

const TEST_KEY = "0123456789abcdef0123456789abcdef";

describe("配置中心 namespace(真实协议路径)", () => {
  let srv: TestWebdavServer;
  let center: ConfigCenter;

  beforeAll(async () => {
    srv = await startTestWebdavServer();
    // 预建 namespace 目录(生产环境需预先存在,测试用本地服务器可建)
    const raw = createWebdavClient({ url: srv.url, username: srv.username, password: srv.password });
    for (const dir of [
      "/amechan",
      "/amechan/configs",
      "/amechan/secrets",
      "/amechan/configs/bilibili",
      "/amechan/secrets/bilibili",
      "/amechan/secrets/xiaoheihe",
      "/amechan/configs/steam",
      "/amechan/configs/netease",
      "/amechan/secrets/secret",
    ]) {
      await raw.mkdir(dir);
    }
    center = createConfigCenter({
      global: {
        url: srv.url,
        username: srv.username,
        password: srv.password,
        key: TEST_KEY,
      },
    });
  });

  afterAll(async () => {
    await srv.stop();
  });

  it("明文域存取往返", async () => {
    const ns = center.namespace("bilibili"); // encrypt 默认 false
    expect(ns.encrypt).toBe(false);
    await ns.set("ui", { quality: 80, theme: "dark" });
    expect(await ns.get<{ quality: number; theme: string }>("ui")).toEqual({ quality: 80, theme: "dark" });
  });

  it("加密域存取往返 + 云端密文不含明文", async () => {
    const ns = center.namespace("xiaoheihe", { encrypt: true });
    expect(ns.encrypt).toBe(true);
    await ns.set("auth", { cookie: "SID=super-secret" });
    expect(await ns.get<{ cookie: string }>("auth")).toEqual({ cookie: "SID=super-secret" });

    // 直接用底层 ConfigStore 读:路径 /secrets/xiaoheihe/,内容为密文
    const raw = createConfigStore({
      client: createWebdavClient({ url: srv.url, username: srv.username, password: srv.password }),
      basePath: "/amechan/secrets/xiaoheihe",
      format: "text",
    });
    const cipher = await raw.load<string>("auth");
    expect(cipher).not.toContain("super-secret");
  });

  it("明文与加密域路径隔离", async () => {
    // /configs/bilibili 与 /secrets/bilibili 互不影响
    const plain = center.namespace("bilibili");
    const secret = center.namespace("bilibili", { encrypt: true });
    await plain.set("same-key", { kind: "plain" });
    await secret.set("same-key", { kind: "secret" });
    expect(await plain.get<{ kind: string }>("same-key")).toEqual({ kind: "plain" });
    expect(await secret.get<{ kind: string }>("same-key")).toEqual({ kind: "secret" });
  });

  it("list / remove", async () => {
    const ns = center.namespace("steam");
    await ns.set("a", { x: 1 });
    await ns.set("b", { y: 2 });
    const names = await ns.list();
    expect(names).toEqual(expect.arrayContaining(["a", "b"]));
    await ns.remove("a");
    expect(await ns.list()).not.toContain("a");
  });

  it("get 不存在 → NOT_FOUND", async () => {
    const ns = center.namespace("netease");
    await expect(ns.get("nope")).rejects.toMatchObject({ code: WebdavErrorCode.NOT_FOUND });
  });

  it("非法 namespace → VALIDATION", () => {
    expect(() => center.namespace("../escape")).toThrowError(
      expect.objectContaining({ code: WebdavErrorCode.VALIDATION }),
    );
    expect(() => center.namespace("a/b")).toThrowError(
      expect.objectContaining({ code: WebdavErrorCode.VALIDATION }),
    );
  });

  it("加密域缺密钥 → VALIDATION(密钥不从环境变量来时不配置)", () => {
    const centerNoKey = createConfigCenter({
      global: { url: srv.url, username: srv.username, password: srv.password },
    });
    expect(() => centerNoKey.namespace("secret", { encrypt: true })).toThrowError(
      expect.objectContaining({ code: WebdavErrorCode.VALIDATION }),
    );
  });
});
