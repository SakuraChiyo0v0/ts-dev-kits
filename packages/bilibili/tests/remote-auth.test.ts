import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthStore } from "@sakurachiyo0v0/account";
import { createConfigCenter } from "@sakurachiyo0v0/config";
import { createWebdavClient } from "@sakurachiyo0v0/webdav";
import { createBilibiliClient } from "../src/client.js";
import { startTestWebdavServer, type TestWebdavServer } from "../../../shared/test-helpers/webdav-test-server.js";

const TEST_KEY = "0123456789abcdef0123456789abcdef";

describe("B站远程登录态(配置中心加密域)", () => {
  let srv: TestWebdavServer;
  let remote: ReturnType<ReturnType<typeof createConfigCenter>["namespace"]>;

  beforeAll(async () => {
    srv = await startTestWebdavServer();
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
    const dirA = mkdtempSync(join(tmpdir(), "bili-remote-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "bili-remote-b-"));

    const storeA = new AuthStore({ platform: "bilibili", path: join(dirA, "auth.json"), remote });
    await storeA.save({
      platform: "bilibili",
      credentials: { SESSDATA: "mock-sessdata", bili_jct: "mock-jct", DedeUserID: "10001" },
      savedAt: new Date().toISOString(),
    });

    // 新机:从远程还原并回写本地
    const storeB = new AuthStore({ platform: "bilibili", path: join(dirB, "auth.json"), remote });
    const restored = await storeB.load();
    expect(restored?.credentials).toMatchObject({ SESSDATA: "mock-sessdata" });

    // 构造 client(带 remote):不抛错
    const client = createBilibiliClient({ remote });
    expect(client).toBeDefined();
  });

  it("远程不可达时降级:client 构造仍可用(本地缓存)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bili-remote-fail-"));
    const badCenter = createConfigCenter({
      global: { url: srv.url, username: srv.username, password: "wrong", key: TEST_KEY },
    });
    const badNs = badCenter.namespace("auth", { encrypt: true });
    const store = new AuthStore({ platform: "bilibili", path: join(dir, "auth.json"), remote: badNs });
    await store.save({
      platform: "bilibili",
      credentials: { SESSDATA: "local-only" },
      savedAt: new Date().toISOString(),
    });
    const client = createBilibiliClient({ remote: badNs });
    expect(client).toBeDefined();
  });
});
