import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthStore } from "@sakurachiyo0v0/account";
import { createConfigCenter } from "@sakurachiyo0v0/config";
import { createWebdavClient } from "@sakurachiyo0v0/webdav";
import { createVrchatClient } from "../src/client.js";
import { startTestWebdavServer, type TestWebdavServer } from "./helpers/webdav-test-server.js";

const TEST_KEY = "0123456789abcdef0123456789abcdef";

describe("VRChat 远程登录态(配置中心加密域)", () => {
  let srv: TestWebdavServer;
  let remote: ReturnType<ReturnType<typeof createConfigCenter>["namespace"]>;

  beforeAll(async () => {
    srv = await startTestWebdavServer();
    // 建 /amechan/secrets/auth 目录
    const raw = createWebdavClient({ url: srv.url, username: srv.username, password: srv.password });
    await raw.mkdir("/amechan");
    await raw.mkdir("/amechan/secrets");
    await raw.mkdir("/amechan/secrets/auth");

    const center = createConfigCenter({
      global: { url: srv.url, username: srv.username, password: srv.password, key: TEST_KEY },
    });
    remote = center.namespace("auth", { encrypt: true });
  });

  afterAll(async () => {
    await srv.stop();
  });

  it("remote 登录态:存 → 新机还原 → client 构造可用(带 cookie)", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "vrchat-remote-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "vrchat-remote-b-"));

    // 电脑 A:登录态存本地 + 远程(加密)
    const storeA = new AuthStore({ platform: "vrchat", path: join(dirA, "auth.json"), remote });
    await storeA.save({
      platform: "vrchat",
      credentials: { authCookie: "auth=authcookie_mock-token-999" },
      savedAt: new Date().toISOString(),
    });

    // 电脑 B(新机,无本地缓存):load() 从远程还原并回写本地
    const storeB = new AuthStore({ platform: "vrchat", path: join(dirB, "auth.json"), remote });
    const restored = await storeB.load();
    expect(restored?.credentials).toMatchObject({ authCookie: "auth=authcookie_mock-token-999" });

    // 构造 client(带 remote):能从还原后的本地缓存加载 cookie,不抛错
    const client = await createVrchatClient({ remote });
    expect(client).toBeDefined();
  });

  it("远程不可达时降级:client 构造仍可用(本地缓存)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vrchat-remote-fail-"));
    // 错误密码的远程 → save/load 降级本地
    const badCenter = createConfigCenter({
      global: { url: srv.url, username: srv.username, password: "wrong", key: TEST_KEY },
    });
    const badNs = badCenter.namespace("auth", { encrypt: true });
    const store = new AuthStore({ platform: "vrchat", path: join(dir, "auth.json"), remote: badNs });
    await store.save({
      platform: "vrchat",
      credentials: { authCookie: "auth=authcookie_local-only" },
      savedAt: new Date().toISOString(),
    });
    // 远程失败不抛,本地可用,client 构造正常
    const client = await createVrchatClient({ remote: badNs });
    expect(client).toBeDefined();
  });
});
