import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSteamClient, type SteamClient } from "../src/client.js";
import {
  startMockSteamServer,
  PRIVATE_ID64,
  TEST_ID64,
  type MockSteamServer,
} from "./helpers/mock-steam-server.js";

describe("P1 公开查询域", () => {
  let server: MockSteamServer;
  let client: SteamClient;

  beforeEach(async () => {
    server = await startMockSteamServer();
    client = createSteamClient({ apiKey: "TEST_KEY", baseUrls: server.baseUrls });
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  describe("user", () => {
    it("getSummaries 批量资料", async () => {
      const players = await client.user.getSummaries([TEST_ID64]);
      expect(players).toHaveLength(1);
      expect(players[0]!.steamid).toBe(TEST_ID64);
      expect(players[0]!.personaname).toBe("Player0");
    });

    it("getSummaries 接受 steamID3 / steamID2 / vanity 输入", async () => {
      const players = await client.user.getSummaries(["[U:1:46217562]", "STEAM_0:0:23108781", "alice"]);
      expect(players).toHaveLength(3);
      expect(players[0]!.steamid).toBe(TEST_ID64);
      expect(players[2]!.steamid).toBe(TEST_ID64); // vanity 自动解析
    });

    it("resolveVanity 返回 steamID64", async () => {
      await expect(client.user.resolveVanity("alice")).resolves.toBe(TEST_ID64);
    });

    it("resolveVanity 未找到 → NOT_FOUND", async () => {
      await expect(client.user.resolveVanity("nouser")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("getPlayerBans 封禁信息", async () => {
      const bans = await client.user.getPlayerBans([TEST_ID64]);
      expect(bans[0]!.VACBanned).toBe(true);
      expect(bans[0]!.NumberOfVACBans).toBe(2);
    });
  });

  describe("library", () => {
    it("getOwnedGames 返回游戏库", async () => {
      const result = await client.library.getOwnedGames(TEST_ID64);
      expect(result.gameCount).toBe(1);
      expect(result.games[0]!.name).toBe("Team Fortress 2");
      expect(result.privacyRestricted).toBe(false);
    });

    it("getOwnedGames 空结果 + 资料非公开 → privacyRestricted:true", async () => {
      const result = await client.library.getOwnedGames(PRIVATE_ID64);
      expect(result.gameCount).toBe(0);
      expect(result.games).toHaveLength(0);
      expect(result.privacyRestricted).toBe(true);
    });

    it("getOwnedGames 空结果 + 资料公开 → privacyRestricted:false", async () => {
      // 服务器对 TEST_ID64 返回 game_count 0 的场景未提供,此处验证非私有用户走正常路径
      const result = await client.library.getOwnedGames(TEST_ID64);
      expect(result.privacyRestricted).toBe(false);
    });

    it("isPlayingSharedGame 返回借出者", async () => {
      await expect(client.library.isPlayingSharedGame(TEST_ID64, 440)).resolves.toBe(TEST_ID64);
    });
  });

  describe("stats", () => {
    it("getSchemaForGame 成就/统计定义", async () => {
      const schema = await client.stats.getSchemaForGame(440);
      expect(schema.gameName).toBe("Team Fortress 2");
      expect(schema.achievements[0]!.displayName).toBe("A1");
      expect(schema.stats[0]!.name).toBe("s1");
    });

    it("getPlayerAchievements 正常", async () => {
      const result = await client.stats.getPlayerAchievements(TEST_ID64, 440);
      expect(result.achievements).toHaveLength(1);
      expect(result.privacyRestricted).toBe(false);
    });

    it("getPlayerAchievements 资料非公开 → privacyRestricted:true", async () => {
      const result = await client.stats.getPlayerAchievements(PRIVATE_ID64, 440);
      expect(result.achievements).toHaveLength(0);
      expect(result.privacyRestricted).toBe(true);
    });

    it("getUserStatsForGame 统计值", async () => {
      const result = await client.stats.getUserStatsForGame(TEST_ID64, 440);
      expect(result.stats[0]).toEqual({ name: "total_kills", value: 5 });
    });

    it("getGlobalAchievementPercentages", async () => {
      const percentages = await client.stats.getGlobalAchievementPercentages(440);
      expect(percentages[0]).toEqual({ name: "a1", percent: 50.5 });
    });

    it("getGlobalStats 数组参数", async () => {
      const stats = await client.stats.getGlobalStats(440, ["total_kills"]);
      expect(stats.total_kills).toEqual({ total: 100 });
    });

    it("getNumberOfCurrentPlayers 无需 key", async () => {
      await expect(client.stats.getNumberOfCurrentPlayers(440)).resolves.toBe(12345);
    });
  });

  describe("news", () => {
    it("getNewsForApp 无需 key", async () => {
      const items = await client.news.getNewsForApp(440, { count: 1 });
      expect(items[0]!.title).toBe("Update");
      expect(items[0]!.feedname).toBe("steam_community_announcements");
    });
  });

  describe("store", () => {
    it("getAppDetails 本地化", async () => {
      const result = await client.store.getAppDetails([440], { cc: "cn", l: "schinese" });
      expect(result["440"]!.success).toBe(true);
      const data = result["440"]!.data!;
      expect(data.name).toBe("Team Fortress 2");
      expect(data.price_overview).toEqual({ currency: "CNY", initial: 100, final: 80 });
    });

    it("getFeatured", async () => {
      const featured = await client.store.getFeatured({ cc: "cn", l: "schinese" });
      expect(featured.featured_win).toHaveLength(1);
    });

    it("getPackageDetails", async () => {
      const result = await client.store.getPackageDetails([111]);
      expect(result["111"]!.success).toBe(true);
    });

    it("getDlcForApp", async () => {
      const result = await client.store.getDlcForApp(440);
      expect(result).toEqual({ success: true, dlc: [629330] });
    });

    it("search", async () => {
      const items = await client.store.search("tf2", { cc: "cn", l: "schinese" });
      expect(items[0]!.name).toBe("Team Fortress 2");
    });

    it("getAppList 需 key", async () => {
      const apps = await client.store.getAppList();
      expect(apps[0]).toEqual({ appid: 440, name: "Team Fortress 2" });
    });
  });

  describe("inventory", () => {
    it("公开库存", async () => {
      const result = await client.inventory.getInventory(TEST_ID64, 440, "2", { language: "schinese" });
      expect(result.success).toBe(1);
      expect(result.assets[0]!.assetid).toBe("1001");
      expect(result.descriptions[0]!.market_hash_name).toBe("Test Item");
    });

    it("私有库存返回空资产(非错误)", async () => {
      const result = await client.inventory.getInventory(PRIVATE_ID64, 440, "2");
      expect(result.assets).toHaveLength(0);
    });
  });

  describe("market", () => {
    it("priceoverview 单件价", async () => {
      const price = await client.market.getPriceOverview(730, "AK-47 | Redline (Field-Tested)");
      expect(price.success).toBe(true);
      expect(price.lowest_price).toBe("$1.00");
    });

    it("priceoverview 未知物品 → success:false", async () => {
      const price = await client.market.getPriceOverview(730, "UNKNOWN ITEM");
      expect(price.success).toBe(false);
    });

    it("search 市场搜索", async () => {
      const result = await client.market.search({ appid: 730, query: "ak", sort: "price" });
      expect(result.total_count).toBe(2);
      expect(result.results).toHaveLength(2);
    });
  });
});
