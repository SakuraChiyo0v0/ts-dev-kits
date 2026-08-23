import { afterEach, describe, expect, it } from "vitest";
import { BoothSession } from "../src/session.js";
import { ItemApi, parseItemPage, parseItemDetail, extractCsrfToken, extractPriceYen, extractSeller } from "../src/api/item.js";
import { BoothError } from "../src/errors.js";
import { createMockBoothServer, itemPageHtml, type MockBoothServer, type ItemFixture } from "./helpers/mock-server.js";

let server: MockBoothServer | null = null;

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

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }
});

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

describe("parseItemPage", () => {
  it("解析免费商品", () => {
    const item = parseItemPage(itemPageHtml(fixture()), "1001");
    expect(item.id).toBe("1001");
    expect(item.title).toBe("Free Asset Pack");
    expect(item.priceYen).toBe(0);
    expect(item.shopId).toBe("shop-1");
    expect(item.shopName).toBe("Test Shop");
    expect(item.alreadyOwned).toBe(false);
    expect(item.csrfToken).toBe("csrf-1001");
  });

  it("解析付费商品", () => {
    const item = parseItemPage(itemPageHtml(fixture({ priceYen: 500 })), "1001");
    expect(item.priceYen).toBe(500);
  });

  it("解析已拥有标记", () => {
    const item = parseItemPage(itemPageHtml(fixture({ alreadyOwned: true })), "1001");
    expect(item.alreadyOwned).toBe(true);
  });

  it("无商品数据抛 API_ERROR", () => {
    try {
      parseItemPage("<!doctype html><html><body>nothing</body></html>", "1001");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as BoothError).code).toBe("API_ERROR");
    }
  });
});

describe("extractCsrfToken", () => {
  it("meta 标签提取", () => {
    expect(extractCsrfToken('<meta name="csrf-token" content="tok-1">')).toBe("tok-1");
  });

  it("隐藏 input 回退提取", () => {
    expect(extractCsrfToken('<input name="_token" value="tok-2">')).toBe("tok-2");
  });

  it("缺失返回 undefined", () => {
    expect(extractCsrfToken("<html></html>")).toBeUndefined();
  });
});

describe("extractPriceYen", () => {
  it("从 offers.price 提取", () => {
    const product = { offers: { price: "1200" } };
    expect(extractPriceYen(product as unknown as Record<string, unknown>)).toBe(1200);
  });

  it("缺 offers 视为 0", () => {
    expect(extractPriceYen({})).toBe(0);
  });

  it("AggregateOffer 取 lowPrice", () => {
    const product = { offers: { lowPrice: "600", highPrice: "60000" } };
    expect(extractPriceYen(product as unknown as Record<string, unknown>)).toBe(600);
  });
});

describe("extractSeller(brand 形态)", () => {
  it("从 brand.url 子域名提取 shopId,name 作 shopName", () => {
    const product = { brand: { "@type": "Brand", name: "Lielii", url: "https://lielsshop.booth.pm/" } };
    const seller = extractSeller(product as unknown as Record<string, unknown>);
    expect(seller.shopId).toBe("lielsshop");
    expect(seller.shopName).toBe("Lielii");
  });

  it("无 URL 时用 name 作 shopId", () => {
    const product = { brand: { "@type": "Brand", name: "MyShop" } };
    const seller = extractSeller(product as unknown as Record<string, unknown>);
    expect(seller.shopId).toBe("MyShop");
    expect(seller.shopName).toBe("MyShop");
  });

  it("无 brand 返回空 shopId", () => {
    expect(extractSeller({}).shopId).toBe("");
  });
});

describe("parseItemPage(brand + AggregateOffer 真实形态)", () => {
  it("解析真实 BOOTH 页面结构", () => {
    const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="csrf-token" content="csrf-real">
<title>🌱Wonderous🍃 - Lielii - BOOTH</title>
<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "🌱Wonderous🍃 【18vatars】",
      offers: { "@type": "AggregateOffer", lowPrice: "600", highPrice: "60000", priceCurrency: "JPY" },
      brand: { "@type": "Brand", name: "Lielii", url: "https://lielsshop.booth.pm/" },
    })}</script>
</head><body><h1>item</h1></body></html>`;
    const item = parseItemPage(html, "6913184");
    expect(item.id).toBe("6913184");
    expect(item.title).toBe("🌱Wonderous🍃 【18vatars】");
    expect(item.priceYen).toBe(600);
    expect(item.shopId).toBe("lielsshop");
    expect(item.shopName).toBe("Lielii");
    expect(item.csrfToken).toBe("csrf-real");
  });
});

describe("ItemApi.getItem", () => {
  it("通过 mock 服务器拉取商品", async () => {
    await withServer(async (srv) => {
      srv.setItem(fixture({ id: "1001" }));
      const session = new BoothSession({ baseUrl: srv.url, cookie: "_pixiv_session=test" });
      const api = new ItemApi(session);
      const item = await api.getItem("1001");
      expect(item.title).toBe("Free Asset Pack");
      expect(item.priceYen).toBe(0);
    });
  });

  it("404 → NOT_FOUND", async () => {
    await withServer(async (srv) => {
      srv.setItem(fixture({ id: "1001", notFound: true }));
      const session = new BoothSession({ baseUrl: srv.url, cookie: "_pixiv_session=test" });
      const api = new ItemApi(session);
      try {
        await api.getItem("1001");
        throw new Error("should have thrown");
      } catch (error) {
        expect((error as BoothError).code).toBe("NOT_FOUND");
      }
    });
  });

  it("登录页特征 → LOGIN_REQUIRED", async () => {
    await withServer(async (srv) => {
      srv.setItem(fixture({ id: "1001", loginRequired: true }));
      const session = new BoothSession({ baseUrl: srv.url, cookie: "_pixiv_session=test" });
      const api = new ItemApi(session);
      try {
        await api.getItem("1001");
        throw new Error("should have thrown");
      } catch (error) {
        expect((error as BoothError).code).toBe("LOGIN_REQUIRED");
      }
    });
  });
});

describe("parseItemDetail / extractDescription / extractVariations", () => {
  it("多购买项商品:提取简介 + 全部购买项", () => {
    const html = itemPageHtml(
      fixture({
        id: "5703",
        title: "【無料版あり】ポーズ集",
        priceYen: 800,
        description: "VRChatや商品サムネイル等に使えるポーズ集です!",
        variations: [
          { id: "9631171", name: "無料版【全10種】", priceYen: 0, downloadUrl: "/downloadables/4478059?variation_id=9631171" },
          { id: "9631027", name: "有料版【全118種】", priceYen: 800 },
        ],
      }),
    );
    const detail = parseItemDetail(html, "5703");
    expect(detail.description).toBe("VRChatや商品サムネイル等に使えるポーズ集です!");
    expect(detail.variations).toHaveLength(2);
    const free = detail.variations[0]!;
    expect(free.name).toBe("無料版【全10種】");
    expect(free.priceYen).toBe(0);
    expect(free.free).toBe(true);
    expect(free.downloadUrl).toBe("/downloadables/4478059?variation_id=9631171");
    expect(free.variationId).toBe("9631171");
    const paid = detail.variations[1]!;
    expect(paid.name).toBe("有料版【全118種】");
    expect(paid.priceYen).toBe(800);
    expect(paid.free).toBe(false);
  });

  it("按需裁剪:description:false 时为空字符串, variations:false 时为空数组", () => {
    const html = itemPageHtml(fixture({ id: "1001" }));
    const detail = parseItemDetail(html, "1001", { description: false, variations: false });
    expect(detail.description).toBe("");
    expect(detail.variations).toEqual([]);
  });

  it("单购买项商品(无 variations 区块):合成单个购买项", () => {
    const html = itemPageHtml(fixture({ id: "1001", priceYen: 0 }));
    const detail = parseItemDetail(html, "1001");
    expect(detail.variations).toHaveLength(1);
    expect(detail.variations[0]?.free).toBe(true);
    expect(detail.variations[0]?.downloadUrl).toMatch(/downloadables/);
  });

  it("ItemApi.getItemDetail 通过 mock 服务器拉取详情", async () => {
    await withServer(async (srv) => {
      srv.setItem(
        fixture({
          id: "1001",
          description: "detail text here",
          variations: [
            { id: "9", name: "Free tier", priceYen: 0, downloadUrl: "/downloadables/1?variation_id=9" },
            { id: "10", name: "Paid tier", priceYen: 500 },
          ],
        }),
      );
      const session = new BoothSession({ baseUrl: srv.url, cookie: "_pixiv_session=test" });
      const api = new ItemApi(session);
      const detail = await api.getItemDetail("1001");
      expect(detail.description).toBe("detail text here");
      expect(detail.variations).toHaveLength(2);
      // 按需裁剪
      const slim = await api.getItemDetail("1001", { variations: false });
      expect(slim.variations).toEqual([]);
      expect(slim.description).toBe("detail text here");
    });
  });
});
