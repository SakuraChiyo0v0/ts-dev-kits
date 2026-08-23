import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSteamClient, type SteamClient } from "../src/client.js";
import {
  startMockSteamServer,
  MOCK_GUARD_CODE,
  MOCK_PASSWORD,
  TEST_ID64,
  type MockSteamServer,
} from "./helpers/mock-steam-server.js";

/** P3 登录后只读深水区:订单簿/价格历史/我的挂单与成交/自己库存/交易只读/动态流与评论。 */
describe("P3 只读深水区", () => {
  let server: MockSteamServer;
  let client: SteamClient;
  let tempDir: string;

  beforeEach(async () => {
    server = await startMockSteamServer();
    tempDir = mkdtempSync(join(tmpdir(), "steam-p3-test-"));
    client = createSteamClient({
      apiKey: "TEST_KEY",
      publisherKey: "PUB_KEY",
      baseUrls: server.baseUrls,
      sessionPath: join(tempDir, "auth.json"),
    });
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  /** 快速登录(mock 邮箱 Guard 账号),注入登录态与 cookie。 */
  async function login(): Promise<void> {
    const result = await client.auth.loginWithPassword({
      accountName: "needs2fa",
      password: MOCK_PASSWORD,
      onNeedCode: async () => MOCK_GUARD_CODE,
    });
    expect(result.saved).toBe(true);
  }

  describe("market 深水区", () => {
    it("getItemOrdersHistogram 订单簿(买卖深度)", async () => {
      const result = await client.market.getItemOrdersHistogram(730, "AK-47 | Redline (Field-Tested)", {
        currency: 23,
        language: "schinese",
      });
      expect(result.success).toBe(true);
      expect(result.sell_order_graph).toHaveLength(2);
      expect(result.buy_order_graph).toHaveLength(2);
      expect(result.lowest_sell_order).toBe(1.8);
      expect(result.highest_buy_order).toBe(1.5);
      expect(result.sell_order_count).toBe(13);
    });

    it("getPriceHistory 价格曲线", async () => {
      const result = await client.market.getPriceHistory(730, "AK-47 | Redline (Field-Tested)");
      expect(result.success).toBe(true);
      expect(result.prices).toHaveLength(3);
      expect(result.prices[0]![0]).toBe(1700000000);
      expect(result.prices[0]![1]).toBe(1.5);
    });

    it("getMyListings 未登录 → LOGIN_REQUIRED", async () => {
      await expect(client.market.getMyListings()).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    });

    it("getMyListings 登录后可读", async () => {
      await login();
      const result = await client.market.getMyListings();
      expect(result.success).toBe(true);
      expect(result.total_count).toBe(1);
      expect(result.listings[0]!.market_hash_name).toBe("AK-47 | Redline (Field-Tested)");
      expect(result.listings[0]!.price).toBe(100);
    });

    it("getMyHistory 登录后可读", async () => {
      await login();
      const result = await client.market.getMyHistory();
      expect(result.success).toBe(true);
      expect(result.events[0]!.event_type).toBe("sale");
      expect(result.events[0]!.price).toBe(90);
    });
  });

  describe("inventory 深水区", () => {
    it("getOwnInventory 未登录 → LOGIN_REQUIRED", async () => {
      await expect(client.inventory.getOwnInventory(440, "2")).rejects.toMatchObject({
        code: "LOGIN_REQUIRED",
      });
    });

    it("getOwnInventory 登录后用会话 steamid 读取", async () => {
      await login();
      const result = await client.inventory.getOwnInventory(440, "2", { language: "schinese" });
      expect(result.success).toBe(1);
      expect(result.assets[0]!.appid).toBe(440);
      expect(result.assets[0]!.assetid).toBe("1001");
    });

    it("getItemDefs 无 publisherKey → CONFIGURATION", async () => {
      const keyless = createSteamClient({ baseUrls: server.baseUrls });
      await expect(keyless.inventory.getItemDefs(440)).rejects.toMatchObject({
        code: "CONFIGURATION",
      });
      await keyless.close();
    });

    it("getItemDefs 有 publisherKey 返回物品定义", async () => {
      const result = await client.inventory.getItemDefs(440, { language: "schinese" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.itemdefid).toBe(1);
      expect(result.items[0]!.marketable).toBe(true);
    });
  });

  describe("trade 只读", () => {
    it("getTradeOffers 无 key → CONFIGURATION", async () => {
      const keyless = createSteamClient({ baseUrls: server.baseUrls });
      await expect(keyless.trade.getTradeOffers()).rejects.toMatchObject({ code: "CONFIGURATION" });
      await keyless.close();
    });

    it("getTradeOffers 发出+收到报价", async () => {
      const result = await client.trade.getTradeOffers();
      expect(result.tradeOffersSent).toHaveLength(1);
      expect(result.tradeOffersReceived).toHaveLength(1);
      expect(result.tradeOffersSent[0]!.tradeofferid).toBe("101");
      expect(result.tradeOffersSent[0]!.items_to_give![0]!.market_hash_name).toBe("Test Item");
    });

    it("getTradeOffer 单笔详情", async () => {
      const result = await client.trade.getTradeOffer("123");
      expect(result.offer?.tradeofferid).toBe("123");
      expect(result.offer?.trade_offer_state).toBe(2);
    });

    it("getTradeHistory 历史", async () => {
      const result = await client.trade.getTradeHistory({ maxTrades: 50 });
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]!.tradeid).toBe("9001");
      expect(result.more).toBe(false);
    });

    it("getTradeUrl 未登录 → LOGIN_REQUIRED", async () => {
      await expect(client.trade.getTradeUrl()).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    });

    it("getTradeUrl 登录后解析 token", async () => {
      await login();
      const result = await client.trade.getTradeUrl();
      expect(result.token).toBe("mocktoken123456");
      expect(result.partnerAccountId).toBe(46217562);
      expect(result.url).toContain("partner=46217562");
      expect(result.url).toContain("token=mocktoken123456");
    });
  });

  describe("user 动态流与评论读", () => {
    it("getActivityFeed 解析 recentActivity", async () => {
      const result = await client.user.getActivityFeed(TEST_ID64);
      expect(result.steamid).toBe(TEST_ID64);
      expect(result.activities).toHaveLength(2);
      expect(result.activities[0]!.eventType).toBe("12");
      expect(result.activities[0]!.gameID).toBe("440");
      expect(result.activities[1]!.eventType).toBe("53");
    });

    it("getActivityFeed 无公开动态 → 空数组", async () => {
      const result = await client.user.getActivityFeed("76561198006483291");
      expect(result.activities).toEqual([]);
    });

    it("getComments 读取评论 JSON", async () => {
      const result = await client.user.getComments(TEST_ID64, { count: 5 });
      expect(result.totalCount).toBe(2);
      expect(result.comments).toHaveLength(2);
      expect(result.comments[0]!.author?.personaname).toBe("Friend1");
      expect(result.comments[0]!.text).toBe("nice profile");
    });

    it("getComments 评论区不可见 → 空", async () => {
      const result = await client.user.getComments("76561198006483291");
      expect(result.totalCount).toBe(0);
      expect(result.comments).toEqual([]);
    });
  });
});
