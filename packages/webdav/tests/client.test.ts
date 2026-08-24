import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWebdavClient, WebdavErrorCode } from "../src/index.js";
import { startTestWebdavServer, type TestWebdavServer } from "./helpers/webdav-test-server.js";

describe("webdav 客户端基础操作(真实协议路径)", () => {
  let srv: TestWebdavServer;
  let client: ReturnType<typeof createWebdavClient>;

  beforeAll(async () => {
    srv = await startTestWebdavServer();
    client = createWebdavClient({ url: srv.url, username: srv.username, password: srv.password });
  });

  afterAll(async () => {
    await srv.stop();
  });

  it("ping 通过", async () => {
    await expect(client.ping()).resolves.toBeUndefined();
  });

  it("mkdir / list / put / get 往返", async () => {
    await client.mkdir("/configs");
    await client.put("/configs/app.json", JSON.stringify({ a: 1 }), { overwrite: true });

    const entries = await client.list("/configs");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: "app.json", type: "file" });

    const content = await client.get("/configs/app.json");
    expect(JSON.parse(content)).toEqual({ a: 1 });
  });

  it("exists 判断", async () => {
    expect(await client.exists("/configs/app.json")).toBe(true);
    expect(await client.exists("/configs/nope.json")).toBe(false);
  });

  it("move / copy / remove", async () => {
    await client.copy("/configs/app.json", "/configs/app-copy.json");
    expect(await client.exists("/configs/app-copy.json")).toBe(true);

    await client.move("/configs/app-copy.json", "/configs/renamed.json");
    expect(await client.exists("/configs/app-copy.json")).toBe(false);
    expect(await client.exists("/configs/renamed.json")).toBe(true);

    await client.remove("/configs/renamed.json");
    expect(await client.exists("/configs/renamed.json")).toBe(false);
  });

  // 注:overwrite:false 时客户端发送 If-None-Match,真实服务器(坚果云/Nextcloud)会返回
  // 412 → CONFLICT;本地 webdav-server v2 未实现该检查(直接覆盖),故此处不断言该分支。

  it("二进制读写往返(任意字节)", async () => {
    const buf = Buffer.from([0, 1, 2, 3, 255, 254, 128, 0]);
    await client.putBinary("/configs/data.bin", buf);
    const got = await client.getBinary("/configs/data.bin");
    expect(got.equals(buf)).toBe(true);
    await client.remove("/configs/data.bin");
  });

  it("读不存在文件 → NOT_FOUND", async () => {
    await expect(client.get("/configs/missing.json")).rejects.toMatchObject({
      code: WebdavErrorCode.NOT_FOUND,
    });
  });

  it("认证失败 → AUTHENTICATION", async () => {
    const bad = createWebdavClient({ url: srv.url, username: srv.username, password: "wrong-password" });
    await expect(bad.ping()).rejects.toMatchObject({ code: WebdavErrorCode.AUTHENTICATION });
  });

  it("连接失败 → CONNECTION", async () => {
    const unreachable = createWebdavClient({ url: "http://127.0.0.1:1/", timeoutMs: 3000 });
    await expect(unreachable.ping()).rejects.toMatchObject({ code: WebdavErrorCode.CONNECTION });
  });

  it("配置非法 → VALIDATION", () => {
    expect(() => createWebdavClient({ url: "" })).toThrowError(
      expect.objectContaining({ code: WebdavErrorCode.VALIDATION }),
    );
  });
});
