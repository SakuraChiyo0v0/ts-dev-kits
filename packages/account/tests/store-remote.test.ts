import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConfigCenter } from "@sakurachiyo0v0/config";
import { AuthStore } from "../src/store.js";
import { startTestWebdavServer, type TestWebdavServer } from "../../../shared/test-helpers/webdav-test-server.js";

const TEST_KEY = "0123456789abcdef0123456789abcdef";

function makePayload(overrides?: Partial<Parameters<AuthStore["save"]>[0]>): Parameters<AuthStore["save"]>[0] {
  return {
    platform: "test-platform",
    credentials: { cookie: "SID=mock-session" },
    savedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("AuthStore 远程同步(配置中心加密域)", () => {
  let srv: TestWebdavServer;
  let remoteNs: ReturnType<ReturnType<typeof createConfigCenter>["namespace"]>;

  beforeAll(async () => {
    srv = await startTestWebdavServer();
    // 建加密域目录(测试环境可建;生产坚果云需网页端建)
    const { createWebdavClient } = await import("@sakurachiyo0v0/webdav");
    const raw = createWebdavClient({ url: srv.url, username: srv.username, password: srv.password });
    await raw.mkdir("/amechan");
    await raw.mkdir("/amechan/secrets");
    await raw.mkdir("/amechan/secrets/auth");

    const center = createConfigCenter({
      global: { url: srv.url, username: srv.username, password: srv.password, key: TEST_KEY },
    });
    remoteNs = center.namespace("auth", { encrypt: true });
  });

  afterAll(async () => {
    await srv.stop();
  });

  it("save 双写,新机 load 从远程还原(模拟换机)", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "auth-remote-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "auth-remote-b-"));

    // 电脑 A:登录态存本地 + 远程
    const storeA = new AuthStore({ platform: "test-platform", path: join(dirA, "auth.json"), remote: remoteNs });
    const payload = makePayload();
    await storeA.save(payload);
    expect(storeA.loadSync()).toEqual(payload);

    // 电脑 B:新实例(不同本地路径=无本地缓存),配同一远程 → 从远程还原
    const storeB = new AuthStore({ platform: "test-platform", path: join(dirB, "auth.json"), remote: remoteNs });
    const restored = await storeB.load();
    expect(restored).toEqual(payload);
  });

  it("远程内容为密文(加密域)", async () => {
    // 通过明文 ConfigStore 直接读 /secrets/auth/test-platform,应为密文不含明文
    const { createConfigStore } = await import("@sakurachiyo0v0/webdav");
    const rawStore = createConfigStore({
      client: (await import("@sakurachiyo0v0/webdav")).createWebdavClient({
        url: srv.url,
        username: srv.username,
        password: srv.password,
      }),
      basePath: "/amechan/secrets/auth",
      format: "text",
    });
    const cipher = await rawStore.load<string>("test-platform");
    expect(cipher).not.toContain("mock-session");
  });

  it("远程不可达时降级本地(带告警,不抛错)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auth-remote-fail-"));
    // 错误密码的远程(namespace 惰性连接,load/save 时失败)
    const badCenter = createConfigCenter({
      global: { url: srv.url, username: srv.username, password: "wrong", key: TEST_KEY },
    });
    const badNs = badCenter.namespace("auth", { encrypt: true });
    const store = new AuthStore({ platform: "test-platform", path: join(dir, "auth.json"), remote: badNs });
    const payload = makePayload({ credentials: { cookie: "local-only" } });

    await expect(store.save(payload)).resolves.toBeUndefined(); // 降级,不抛
    expect(store.loadSync()).toEqual(payload); // 本地仍在

    const loaded = await store.load(); // 远程失败 → 降级本地
    expect(loaded).toEqual(payload);
  });

  it("远程 load 成功回写本地缓存(loadSync 可用,SDK 同步构造也能读到)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auth-remote-cache-"));
    const { unlink } = await import("node:fs/promises");

    const store = new AuthStore({ platform: "test-platform", path: join(dir, "auth.json"), remote: remoteNs });
    const payload = makePayload();
    await store.save(payload); // 写本地 + 远程

    // 模拟新机:本地无缓存
    await unlink(join(dir, "auth.json"));
    const fresh = new AuthStore({ platform: "test-platform", path: join(dir, "auth.json"), remote: remoteNs });
    expect(fresh.loadSync()).toBeNull();

    // load() 从远程拉取 → 回写本地缓存
    const restored = await fresh.load();
    expect(restored).toEqual(payload);
    expect(fresh.loadSync()).toEqual(payload); // 已回写,后续 SDK 同步构造可读
  });

  it("clear 同时删除本地与远程", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auth-remote-clear-"));
    const store = new AuthStore({ platform: "test-platform", path: join(dir, "auth.json"), remote: remoteNs });
    await store.save(makePayload());
    await store.clear();
    expect(store.exists()).toBe(false);
    // 新实例读远程 → 已删除 → 本地也空 → null
    const fresh = new AuthStore({ platform: "test-platform", path: join(dir, "auth.json"), remote: remoteNs });
    expect(await fresh.load()).toBeNull();
  });
});
