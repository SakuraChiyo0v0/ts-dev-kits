import { beforeEach, describe, expect, it, vi } from "vitest";
import https from "node:https";
import { createUgAppClient } from "../src/client.js";
import { MockServer, pushLoginFlow, TEST_CONFIG } from "./helpers/mock-https.js";

vi.mock("node:https", () => ({ default: { request: vi.fn() } }));

const PROPFIND_OK = (dir: string) =>
  `<?xml version="1.0"?><multistatus xmlns:D="DAV:"><response><href>/dav${dir}/</href><propstat><prop><D:displayname>下载</D:displayname></prop></propstat></response><response><href>/dav${dir}/red.png</href><propstat><prop><D:displayname>red.png</D:displayname></prop></propstat></response></multistatus>`;

describe("client 上传", () => {
  const server = new MockServer();

  beforeEach(() => {
    server.clear();
    server.install(vi.mocked(https.request));
  });

  it("上传成功返回 201 与远端路径", async () => {
    pushLoginFlow(server);
    server.push(() => ({ status: 201, body: "" }));
    const client = createUgAppClient(TEST_CONFIG);
    const r = await client.upload("test.png", Buffer.from("hello"));
    expect(r).toMatchObject({ ok: true, path: "/DXP4800GT/AmeChan/下载/test.png", status: 201 });
    const put = server.calls[4]!;
    expect(put.method).toBe("PUT");
    expect(put.path).toBe(encodeURI("/dav/DXP4800GT/AmeChan/下载/test.png"));
    expect(put.body.toString()).toBe("hello");
    expect(put.headers["authorization"]).toMatch(/^Basic /);
    expect(put.headers["cookie"]).toBe("ugreen-proxy-token=final-cookie-1");
  });

  it("文件名非法字符被清洗", async () => {
    pushLoginFlow(server);
    server.push(() => ({ status: 201, body: "" }));
    const client = createUgAppClient(TEST_CONFIG);
    const r = await client.upload("a/b:c?.png", "x");
    expect(r.ok && r.path).toContain("a_b_c_.png");
  });

  it("302 后清缓存重登并重试一次", async () => {
    pushLoginFlow(server, "cookie-1");
    server.push(() => ({ status: 302, headers: { location: "/@login" }, body: "" }));
    pushLoginFlow(server, "cookie-2");
    server.push(() => ({ status: 201, body: "" }));
    const client = createUgAppClient(TEST_CONFIG);
    const r = await client.upload("test.png", "x");
    expect(r).toMatchObject({ ok: true, status: 201 });
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts[0]?.headers["cookie"]).toBe("ugreen-proxy-token=cookie-1");
    expect(puts[1]?.headers["cookie"]).toBe("ugreen-proxy-token=cookie-2");
  });

  it("上游 500 返回失败结果", async () => {
    pushLoginFlow(server);
    server.push(() => ({ status: 500, body: "boom" }));
    const client = createUgAppClient(TEST_CONFIG);
    const r = await client.upload("test.png", "x");
    expect(r).toMatchObject({ ok: false, status: 500 });
  });
});

describe("client 列目录 / 测试", () => {
  const server = new MockServer();

  beforeEach(() => {
    server.clear();
    server.install(vi.mocked(https.request));
  });

  it("list 解析 PROPFIND displayname", async () => {
    pushLoginFlow(server);
    server.push(() => ({ status: 207, body: PROPFIND_OK("/DXP4800GT/AmeChan/下载") }));
    const client = createUgAppClient(TEST_CONFIG);
    const r = await client.list();
    expect(r).toEqual({ ok: true, entries: ["下载", "red.png"] });
    const pf = server.calls[4]!;
    expect(pf.method).toBe("PROPFIND");
  });

  it("test 连接成功返回条目", async () => {
    pushLoginFlow(server);
    server.push(() => ({ status: 207, body: PROPFIND_OK("/DXP4800GT/AmeChan/下载") }));
    const client = createUgAppClient(TEST_CONFIG);
    const r = await client.test();
    expect(r.ok).toBe(true);
  });

  it("test 无权限返回失败信息", async () => {
    pushLoginFlow(server);
    server.push(() => ({ status: 401, body: "" }));
    const client = createUgAppClient(TEST_CONFIG);
    const r = await client.test();
    expect(r).toMatchObject({ ok: false, message: "目录无访问权限（检查用户名/密码与目录路径）" });
  });
});


