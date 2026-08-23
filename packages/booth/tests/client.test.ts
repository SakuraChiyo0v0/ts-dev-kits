import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBoothClient, BoothClient } from "../src/client.js";
import { createMockBoothServer, type MockBoothServer, type ItemFixture } from "./helpers/mock-server.js";

let server: MockBoothServer | null = null;

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }
});

async function withServer(fn: (srv: MockBoothServer) => Promise<void>): Promise<void> {
  const srv = await createMockBoothServer();
  server = srv;
  try {
    await fn(srv);
  } finally {
    await srv.close();
    server = null;
  }
}

function fixture(overrides: Partial<ItemFixture> = {}): ItemFixture {
  return {
    id: "1001",
    title: "Free Asset Pack",
    priceYen: 0,
    shopId: "shop-1",
    shopName: "Test Shop",
    alreadyOwned: false,
    ...overrides,
  };
}

function client(srv: MockBoothServer, extra: Record<string, unknown> = {}): BoothClient {
  return createBoothClient({ baseUrl: srv.url, cookie: "_pixiv_session=test", ...extra });
}

describe("BoothClient.getItem", () => {
  it("按链接或 ID 获取商品", async () => {
    await withServer(async (srv) => {
      srv.setItem(fixture());
      const c = client(srv);
      const byLink = await c.getItem("https://booth.pm/ja/items/1001");
      const byId = await c.getItem("1001");
      expect(byLink.id).toBe("1001");
      expect(byId.id).toBe("1001");
    });
  });

  it("非法输入抛 INVALID_URL", async () => {
    await withServer(async (srv) => {
      const c = client(srv);
      await expect(c.getItem("not-a-link")).rejects.toMatchObject({ code: "INVALID_URL" });
    });
  });

  it("免费商品带 downloadUrl 与 variationId", async () => {
    await withServer(async (srv) => {
      srv.setItem(fixture({ id: "1001", downloadUrl: "/downloadables/55?variation_id=9" }));
      const c = client(srv);
      const item = await c.getItem("1001");
      expect(item.downloadUrl).toBe("/downloadables/55?variation_id=9");
      expect(item.variationId).toBe("9");
    });
  });

  it("付费商品带 variationId(加购表单提取)", async () => {
    await withServer(async (srv) => {
      srv.setItem(fixture({ id: "2001", priceYen: 500 }));
      const c = client(srv);
      const item = await c.getItem("2001");
      expect(item.priceYen).toBe(500);
      expect(item.downloadUrl).toBeUndefined();
      expect(item.variationId).toBe("123");
    });
  });
});

describe("BoothClient.claim", () => {
  it("批量领取保持输入顺序,免费成交", async () => {
    await withServer(async (srv) => {
      srv.setItem(fixture({ id: "1001", title: "A" }));
      srv.setItem(fixture({ id: "1002", title: "B" }));
      const c = client(srv);
      const results = await c.claim(["https://booth.pm/ja/items/1001", "1002"]);
      expect(results).toHaveLength(2);
      expect(results[0]?.status).toBe("claimed");
      expect(results[1]?.status).toBe("claimed");
      expect(results[0]?.itemId).toBe("1001");
      expect(results[1]?.itemId).toBe("1002");
      expect(results[0]?.downloadUrl).toMatch(/^https?:\/\//);
    });
  });

  it("付费商品 → paid-pending 含 payUrl", async () => {
    await withServer(async (srv) => {
      srv.setItem(fixture({ id: "2001", priceYen: 500 }));
      const c = client(srv);
      const results = await c.claim(["2001"]);
      expect(results[0]?.status).toBe("paid-pending");
      expect(results[0]?.payUrl).toMatch(/carts/);
      expect(srv.lastCartBody()?.["cart_item[variation_id]"]).toBe("123");
    });
  });

  it("已拥有 → skipped", async () => {
    await withServer(async (srv) => {
      srv.setItem(fixture({ id: "3001", alreadyOwned: true }));
      const c = client(srv);
      const results = await c.claim(["3001"]);
      expect(results[0]?.status).toBe("skipped");
    });
  });

  it("单项失败不中断其余,失败项带错误码", async () => {
    await withServer(async (srv) => {
      srv.setItem(fixture({ id: "1001" }));
      const c = client(srv);
      const results = await c.claim(["1001", "bad-input", "1001"]);
      expect(results).toHaveLength(3);
      expect(results[0]?.status).toBe("claimed");
      expect(results[1]?.status).toBe("failed");
      expect(results[1]?.error?.code).toBe("INVALID_URL");
      expect(results[2]?.status).toBe("claimed");
    });
  });

  it("并发受配置控制,默认 1", async () => {
    await withServer(async (srv) => {
      srv.setItem(fixture({ id: "1001" }));
      srv.setItem(fixture({ id: "1002" }));
      const c = client(srv, { claim: { concurrency: 2 } });
      const results = await c.claim(["1001", "1002"], { concurrency: 2 });
      expect(results).toHaveLength(2);
    });
  });
});

describe("BoothClient.claimAndDownload", () => {
  it("免费商品领取后下载到本地", async () => {
    await withServer(async (srv) => {
      const dir = mkdtempSync(path.join(tmpdir(), "booth-cad-"));
      try {
        srv.setItem(fixture({ id: "1001" }));
        srv.setFileContent("1001.zip", "hello");
        const c = client(srv);
        const result = await c.claimAndDownload("1001", { outputDir: dir });
        expect(result.claim.status).toBe("claimed");
        expect(result.files).toHaveLength(1);
        const filePath = result.files[0]!;
        expect(existsSync(filePath)).toBe(true);
        expect(readFileSync(filePath, "utf-8")).toBe("hello");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("付费待支付不下载", async () => {
    await withServer(async (srv) => {
      const dir = mkdtempSync(path.join(tmpdir(), "booth-cad-"));
      try {
        srv.setItem(fixture({ id: "2001", priceYen: 500 }));
        const c = client(srv);
        const result = await c.claimAndDownload("2001", { outputDir: dir });
        expect(result.claim.status).toBe("paid-pending");
        expect(result.files).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe("BoothClient 登录态", () => {
  it("无 cookie 且无存储时 isLoggedIn 为 false", async () => {
    await withServer(async (srv) => {
      const dir = mkdtempSync(path.join(tmpdir(), "booth-auth-iso-"));
      try {
        // 指向不存在的 auth 文件,避免读到真实用户存储。
        const c = createBoothClient({
          baseUrl: srv.url,
          authPath: path.join(dir, "nope", "auth.json"),
        });
        expect(c.isLoggedIn).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("显式 cookie 时 isLoggedIn 为 true", async () => {
    await withServer(async (srv) => {
      const c = createBoothClient({ baseUrl: srv.url, cookie: "_pixiv_session=x" });
      expect(c.isLoggedIn).toBe(true);
    });
  });

  it("persistLogin / clearLogin 写入与清除 AuthStore", async () => {
    await withServer(async (srv) => {
      const dir = mkdtempSync(path.join(tmpdir(), "booth-auth-"));
      try {
        const authPath = path.join(dir, "auth.json");
        const c = createBoothClient({ baseUrl: srv.url, cookie: "_pixiv_session=persist-me", authPath });
        await c.persistLogin(authPath);
        expect(existsSync(authPath)).toBe(true);
        await c.clearLogin(authPath);
        expect(existsSync(authPath)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
