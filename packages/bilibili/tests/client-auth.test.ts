import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBilibiliClient } from "../src/index.js";
import { startMockApi, type MockApi } from "./helpers/mock-api.js";

const tempDirs: string[] = [];
let mock: MockApi | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function tempAuthFile(data: {
  cookies: string;
  refreshToken: string;
}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "bili-client-auth-"));
  tempDirs.push(dir);
  const file = path.join(dir, "auth.json");
  await fs.writeFile(
    file,
    JSON.stringify({ ...data, savedAt: new Date().toISOString() }),
    "utf-8",
  );
  return file;
}

const videoData = {
  bvid: "BV1xx411c7mD",
  aid: 170001,
  cid: 280001,
  title: "测试视频",
  pic: "https://example.com/cover.jpg",
  duration: 60,
  desc: "desc",
  owner: { mid: 1000, name: "up" },
  pages: [],
};

describe("createBilibiliClient 登录态自动加载", () => {
  it("未显式传 cookie 时从存储加载", async () => {
    const authPath = await tempAuthFile({ cookies: "SESSDATA=stored-sess", refreshToken: "rt" });
    mock = await startMockApi({
      "/x/web-interface/nav": () => ({
        wbi_img: {
          img_url: "https://i0.hdslb.com/bfs/wbi/7cd0849410c1a048bf5d4e47a4e1e1c9.png",
          sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
        },
      }),
      "/x/web-interface/wbi/view": () => videoData,
    });
    const client = createBilibiliClient({ authPath, baseUrl: mock.url });
    const items = await client.parse("https://www.bilibili.com/video/BV1xx411c7mD");
    expect(items[0]?.title).toBe("测试视频");
    const viewRequest = mock.requests.find((r) => r.path.includes("/x/web-interface/wbi/view"));
    expect(viewRequest?.headers.cookie).toContain("SESSDATA=stored-sess");
  });

  it("显式 cookie 优先于存储", async () => {
    const authPath = await tempAuthFile({ cookies: "SESSDATA=stored-sess", refreshToken: "rt" });
    mock = await startMockApi({
      "/x/web-interface/nav": () => ({
        wbi_img: {
          img_url: "https://i0.hdslb.com/bfs/wbi/7cd0849410c1a048bf5d4e47a4e1e1c9.png",
          sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
        },
      }),
      "/x/web-interface/wbi/view": () => videoData,
    });
    const client = createBilibiliClient({
      cookie: "SESSDATA=explicit-sess",
      authPath,
      baseUrl: mock.url,
    });
    await client.parse("https://www.bilibili.com/video/BV1xx411c7mD");
    const viewRequest = mock.requests.find((r) => r.path.includes("/x/web-interface/wbi/view"));
    expect(viewRequest?.headers.cookie).toContain("SESSDATA=explicit-sess");
    expect(viewRequest?.headers.cookie).not.toContain("SESSDATA=stored-sess");
  });

  it("存储不存在时匿名请求,不报错", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "bili-client-auth-"));
    tempDirs.push(dir);
    mock = await startMockApi({
      "/x/web-interface/nav": () => ({
        wbi_img: {
          img_url: "https://i0.hdslb.com/bfs/wbi/7cd0849410c1a048bf5d4e47a4e1e1c9.png",
          sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
        },
      }),
      "/x/web-interface/wbi/view": () => videoData,
    });
    const client = createBilibiliClient({
      authPath: path.join(dir, "missing.json"),
      baseUrl: mock.url,
    });
    const items = await client.parse("https://www.bilibili.com/video/BV1xx411c7mD");
    expect(items[0]?.title).toBe("测试视频");
  });
});

describe("登录态失效自动续期", () => {
  it("-101 时自动刷新 cookie 并重试一次", async () => {
    const authPath = await tempAuthFile({
      cookies: "SESSDATA=old-sess; bili_jct=old-jct; DedeUserID=42",
      refreshToken: "rt-old",
    });

    // API mock:view 第一次返回 -101,第二次成功。
    let viewCalls = 0;
    const apiRequests: Array<{ path: string; cookie?: string }> = [];
    const apiServer: Server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      apiRequests.push({
        path: url.pathname,
        cookie: String(request.headers.cookie ?? ""),
      });
      if (url.pathname === "/x/web-interface/nav") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: 0,
            data: {
              wbi_img: {
                img_url: "https://i0.hdslb.com/bfs/wbi/7cd0849410c1a048bf5d4e47a4e1e1c9.png",
                sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
              },
            },
          }),
        );
        return;
      }
      if (url.pathname === "/x/web-interface/wbi/view") {
        viewCalls += 1;
        if (viewCalls === 1) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ code: -101, message: "账号未登录" }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: 0, data: videoData }));
        return;
      }
      response.writeHead(404);
      response.end("{}");
    });
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
    const apiPort = (apiServer.address() as AddressInfo).port;

    // refresh mock:返回新 cookie。
    let refreshCalls = 0;
    const refreshServer: Server = createServer((request, response) => {
      refreshCalls += 1;
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": ["SESSDATA=new-sess; path=/", "bili_jct=new-jct; path=/"],
      });
      response.end(JSON.stringify({ code: 0, data: { refresh_token: "rt-new" } }));
    });
    await new Promise<void>((resolve) => refreshServer.listen(0, "127.0.0.1", resolve));
    const refreshPort = (refreshServer.address() as AddressInfo).port;

    // 路由:refresh 接口 → refresh mock;其余 → api mock。
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/x/passport-login/web/cookie/refresh")) {
          return originalFetch(
            `http://127.0.0.1:${refreshPort}/x/passport-login/web/cookie/refresh`,
            init,
          );
        }
        return originalFetch(
          url.replace("https://api.bilibili.com", `http://127.0.0.1:${apiPort}`),
          init,
        );
      }) as typeof fetch,
    );

    try {
      const client = createBilibiliClient({ authPath, baseUrl: `http://127.0.0.1:${apiPort}` });
      const items = await client.parse("https://www.bilibili.com/video/BV1xx411c7mD");
      expect(items[0]?.title).toBe("测试视频");
      expect(viewCalls).toBe(2);
      expect(refreshCalls).toBe(1);
      const viewRequests = apiRequests.filter((r) => r.path === "/x/web-interface/wbi/view");
      expect(viewRequests[0]?.cookie).toContain("SESSDATA=old-sess");
      expect(viewRequests[1]?.cookie).toContain("SESSDATA=new-sess");
    } finally {
      await new Promise<void>((resolve) => apiServer.close(() => resolve()));
      await new Promise<void>((resolve) => refreshServer.close(() => resolve()));
    }
  });
});
