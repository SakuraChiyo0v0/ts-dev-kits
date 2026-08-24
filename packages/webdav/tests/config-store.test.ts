import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConfigStore, createWebdavClient, WebdavErrorCode } from "../src/index.js";
import { startTestWebdavServer, type TestWebdavServer } from "./helpers/webdav-test-server.js";

describe("ConfigStore 配置存储(原子写/备份/格式)", () => {
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

  it("save → load 往返(JSON 自动解析)", async () => {
    const store = createConfigStore({ client,  basePath: "/configs", format: "json" });
    await store.save("app.json", { a: 1, nested: { b: "x" } });
    const loaded = await store.load<{ a: number; nested: { b: string } }>("app.json");
    expect(loaded).toEqual({ a: 1, nested: { b: "x" } });
  });

  it("save 自动滚动备份(默认保留 3 份)", async () => {
    const store = createConfigStore({ client,  basePath: "/configs", format: "json" });
    for (let i = 1; i <= 4; i += 1) {
      await store.save("backed.json", { version: i });
    }
    // 保存 4 次后:当前文件=version4;备份滚动为旧版:.bak.1=v3、.bak.2=v2、.bak.3=v1
    const bak1 = await client.get("/configs/backed.json.bak.1");
    const bak2 = await client.get("/configs/backed.json.bak.2");
    const bak3 = await client.get("/configs/backed.json.bak.3");
    expect(JSON.parse(bak1)).toEqual({ version: 3 });
    expect(JSON.parse(bak2)).toEqual({ version: 2 });
    expect(JSON.parse(bak3)).toEqual({ version: 1 });
    expect(await client.exists("/configs/backed.json.bak.4")).toBe(false);
    // 当前文件是最新版本
    const current = await client.get("/configs/backed.json");
    expect(JSON.parse(current)).toEqual({ version: 4 });
  });

  it("backupCount=0 不备份", async () => {
    const store = createConfigStore({ client,  basePath: "/configs", format: "json", backupCount: 0 });
    await store.save("nobackup.json", { v: 1 });
    await store.save("nobackup.json", { v: 2 });
    expect(await client.exists("/configs/nobackup.json.bak.1")).toBe(false);
  });

  it("text 格式原样存取", async () => {
    const store = createConfigStore({ client,  basePath: "/configs", format: "text" });
    await store.save("note.txt", "hello webdav");
    expect(await store.load("note.txt")).toBe("hello webdav");
  });

  it("list 只返回配置,过滤 .tmp 与 .bak.*", async () => {
    const store = createConfigStore({ client,  basePath: "/configs", format: "json" });
    const names = await store.list();
    expect(names).toContain("app.json");
    expect(names).toContain("backed.json");
    expect(names.some((n) => n.includes(".bak."))).toBe(false);
    expect(names.some((n) => n.endsWith(".tmp"))).toBe(false);
  });

  it("remove 删除配置", async () => {
    const store = createConfigStore({ client,  basePath: "/configs", format: "json" });
    await store.save("gone.json", { x: 1 });
    await store.remove("gone.json");
    expect(await client.exists("/configs/gone.json")).toBe(false);
  });

  it("非法配置名 → VALIDATION", async () => {
    const store = createConfigStore({ client,  basePath: "/configs", format: "json" });
    await expect(store.save("../escape.json", {})).rejects.toMatchObject({
      code: WebdavErrorCode.VALIDATION,
    });
    await expect(store.load("a/b.json")).rejects.toMatchObject({ code: WebdavErrorCode.VALIDATION });
  });

  it("load 不存在的配置 → NOT_FOUND", async () => {
    const store = createConfigStore({ client,  basePath: "/configs", format: "json" });
    await expect(store.load("missing.json")).rejects.toMatchObject({ code: WebdavErrorCode.NOT_FOUND });
  });
});
