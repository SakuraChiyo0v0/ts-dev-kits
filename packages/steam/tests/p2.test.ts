import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSteamClient, type SteamClient } from "../src/client.js";
import {
  startMockSteamServer,
  PRIVATE_ID64,
  TEST_ID64,
  type MockSteamServer,
} from "./helpers/mock-steam-server.js";

/** P2 登录后只读查询:好友/等级/徽章/群组/近期游戏/愿望单/创意工坊。 */
describe("P2 只读查询", () => {
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

  describe("user 扩展", () => {
    it("getFriendList 公开资料", async () => {
      const result = await client.user.getFriendList(TEST_ID64);
      expect(result.friends[0]!.relationship).toBe("friend");
      expect(result.friends[0]!.steamid).toBe("76561198006483292");
      expect(result.privacyRestricted).toBe(false);
    });

    it("getFriendList 资料未公开 → privacyRestricted:true 不抛错", async () => {
      const result = await client.user.getFriendList(PRIVATE_ID64);
      expect(result.friends).toHaveLength(0);
      expect(result.privacyRestricted).toBe(true);
    });

    it("getSteamLevel", async () => {
      await expect(client.user.getSteamLevel(TEST_ID64)).resolves.toBe(42);
    });

    it("getBadges", async () => {
      const result = await client.user.getBadges(TEST_ID64);
      expect(result.playerLevel).toBe(42);
      expect(result.badges[0]!.badgeid).toBe(1);
      expect(result.playerXp).toBe(1000);
    });

    it("getCommunityBadgeProgress", async () => {
      const result = await client.user.getCommunityBadgeProgress(TEST_ID64, 1);
      expect(result.badgeid).toBe(1);
      expect(result.quests).toHaveLength(2);
      expect(result.quests[0]!.completed).toBe(true);
    });

    it("getUserGroupList", async () => {
      const result = await client.user.getUserGroupList(TEST_ID64);
      expect(result.groups[0]!.gid).toBe("103582791433293646");
    });
  });

  describe("library 扩展", () => {
    it("getRecentlyPlayedGames", async () => {
      const result = await client.library.getRecentlyPlayedGames(TEST_ID64, { count: 5 });
      expect(result.totalCount).toBe(1);
      expect(result.games[0]!.name).toBe("Team Fortress 2");
      expect(result.games[0]!.playtime_2weeks).toBe(60);
    });

    it("getWishlist 公开", async () => {
      const result = await client.library.getWishlist(TEST_ID64);
      expect(result.privacyRestricted).toBe(false);
      expect(result.entries["440"]!.name).toBe("Team Fortress 2");
      expect(result.entries["570"]).toBeDefined();
    });

    it("getWishlist 未公开 → privacyRestricted:true", async () => {
      const result = await client.library.getWishlist(PRIVATE_ID64);
      expect(result.entries).toEqual({});
      expect(result.privacyRestricted).toBe(true);
    });

    it("getWishlist community 返回 HTML 通用页(隐私/风控)→ privacyRestricted:true,不产生垃圾条目", async () => {
      const result = await client.library.getWishlist("76561198006483293");
      expect(result.entries).toEqual({});
      expect(result.privacyRestricted).toBe(true);
    });
  });

  describe("workshop", () => {
    it("getPublishedFileDetails 无需 key,POST form 数组参数", async () => {
      const items = await client.workshop.getPublishedFileDetails([1, 2]);
      expect(items).toHaveLength(2);
      expect(items[0]!.publishedfileid).toBe("1");
      expect(items[0]!.creator).toBe(TEST_ID64);
    });

    it("enumerateUserPublishedFiles(需 key)", async () => {
      const result = await client.workshop.enumerateUserPublishedFiles(TEST_ID64, { page: 1 });
      expect(result.total).toBe(1);
      expect(result.files[0]!.filename).toBe("a.vpk");
    });

    it("enumerateUserSubscribedFiles(需 key)", async () => {
      const result = await client.workshop.enumerateUserSubscribedFiles(TEST_ID64);
      expect(result.files[0]!.publishedfileid).toBe("1");
    });
  });
});
