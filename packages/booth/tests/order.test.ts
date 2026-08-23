import { afterEach, describe, expect, it } from "vitest";
import { BoothSession } from "../src/session.js";
import { ClaimApi, extractRedirectLocation, toClaimResult } from "../src/api/order.js";
import { BoothError } from "../src/errors.js";
import type { BoothItem } from "../src/types.js";
import { createMockBoothServer, type MockBoothServer } from "./helpers/mock-server.js";

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

function item(overrides: Partial<BoothItem> = {}): BoothItem {
  return {
    id: "1001",
    title: "Free Asset Pack",
    priceYen: 0,
    shopId: "shop-1",
    alreadyOwned: false,
    csrfToken: "csrf-1001",
    ...overrides,
  };
}

async function claimApi(srv: MockBoothServer): Promise<ClaimApi> {
  const session = new BoothSession({ baseUrl: srv.url, cookie: "_pixiv_session=test" });
  return new ClaimApi(session);
}

describe("extractRedirectLocation", () => {
  it("提取 Location 头", () => {
    const response = new Response(null, { status: 302, headers: { Location: "https://s3.example/file.zip" } });
    expect(extractRedirectLocation(response)).toBe("https://s3.example/file.zip");
  });

  it("无 Location → undefined", () => {
    const response = new Response(null, { status: 200 });
    expect(extractRedirectLocation(response)).toBeUndefined();
  });
});

describe("ClaimApi.claim", () => {
  it("免费商品 → claimed + downloadUrl(302 → S3 直链)", async () => {
    await withServer(async (srv) => {
      srv.setItem({
        id: "1001",
        title: "Free Asset Pack",
        priceYen: 0,
        shopId: "shop-1",
        shopName: "Shop One",
      });
      srv.setDownloadablesRedirect("1", "https://s3.example/files/free.zip");
      const api = await claimApi(srv);
      const result = await api.claim(item({ downloadUrl: "/downloadables/1?variation_id=9" }));
      expect(result.kind).toBe("claimed");
      expect(result.downloadUrl).toBe("https://s3.example/files/free.zip");
    });
  });

  it("免费商品无 downloadUrl → API_ERROR", async () => {
    await withServer(async (srv) => {
      const api = await claimApi(srv);
      try {
        await api.claim(item({}));
        throw new Error("should have thrown");
      } catch (error) {
        expect((error as BoothError).code).toBe("API_ERROR");
      }
    });
  });

  it("付费商品 → paid-pending + 购物车 payUrl", async () => {
    await withServer(async (srv) => {
      srv.setCartHandler((): { kind: "ok" | "login-required" | "error"; status?: number } => ({
        kind: "ok",
      }));
      const api = await claimApi(srv);
      const result = await api.claim(item({ priceYen: 500, variationId: "123" }));
      expect(result.kind).toBe("paid-pending");
      expect(result.payUrl).toBeTruthy();
    });
  });

  it("付费商品无 variationId → API_ERROR", async () => {
    await withServer(async (srv) => {
      const api = await claimApi(srv);
      try {
        await api.claim(item({ priceYen: 500 }));
        throw new Error("should have thrown");
      } catch (error) {
        expect((error as BoothError).code).toBe("API_ERROR");
      }
    });
  });

  it("已拥有 → skipped", async () => {
    await withServer(async (srv) => {
      const api = await claimApi(srv);
      const result = await api.claim(item({ alreadyOwned: true }));
      expect(result.kind).toBe("skipped");
    });
  });

  it("加购未登录(401)→ LOGIN_REQUIRED", async () => {
    await withServer(async (srv) => {
      srv.setCartHandler((): { kind: "login-required"; status?: number } => ({
        kind: "login-required",
        status: 401,
      }));
      const api = await claimApi(srv);
      try {
        await api.claim(item({ priceYen: 500, variationId: "123" }));
        throw new Error("should have thrown");
      } catch (error) {
        expect((error as BoothError).code).toBe("LOGIN_REQUIRED");
      }
    });
  });

  it("加购遇 403(Cloudflare)→ 降级 paid-pending + 购物车 URL", async () => {
    await withServer(async (srv) => {
      srv.setCartHandler((): { kind: "error"; status?: number } => ({ kind: "error", status: 403 }));
      const api = await claimApi(srv);
      const result = await api.claim(item({ priceYen: 500, variationId: "123" }));
      expect(result.kind).toBe("paid-pending");
      expect(result.payUrl).toBe("https://booth.pm/carts");
    });
  });
});

describe("toClaimResult", () => {
  it("claimed 映射含 downloadUrl", () => {
    const result = toClaimResult("https://booth.pm/ja/items/1001", "1001", {
      kind: "claimed",
      downloadUrl: "https://s3.example/files/a.zip",
    });
    expect(result.status).toBe("claimed");
    expect(result.downloadUrl).toBe("https://s3.example/files/a.zip");
    expect(result.error).toBeUndefined();
  });

  it("paid-pending 映射", () => {
    const result = toClaimResult("1001", "1001", {
      kind: "paid-pending",
      payUrl: "https://booth.pm/carts",
    });
    expect(result.status).toBe("paid-pending");
    expect(result.payUrl).toBe("https://booth.pm/carts");
  });

  it("skipped 映射", () => {
    const result = toClaimResult("1001", "1001", { kind: "skipped" });
    expect(result.status).toBe("skipped");
    expect(result.downloadUrl).toBeUndefined();
  });
});
