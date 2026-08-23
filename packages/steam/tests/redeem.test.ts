import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSteamClient, type SteamClient } from "../src/client.js";
import {
  startMockSteamServer,
  MOCK_GUARD_CODE,
  MOCK_PASSWORD,
  type MockSteamServer,
} from "./helpers/mock-steam-server.js";

/**
 * 新能力:商店评测(公开)+ 激活码兑换(全 SDK 唯一写操作,红线经用户拍板扩展)。
 * 激活码兑换走真实协议:GET /account/registerkey(302 + Set-Cookie 会话刷新)
 * → POST /account/ajaxregisterkey/ → JSON。
 */
describe("商店评测与激活码兑换", () => {
  let server: MockSteamServer;
  let client: SteamClient;
  let tempDir: string;

  beforeEach(async () => {
    server = await startMockSteamServer();
    tempDir = mkdtempSync(join(tmpdir(), "steam-redeem-test-"));
    client = createSteamClient({
      apiKey: "TEST_KEY",
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

  describe("getAppReviews 商店评测(公开)", () => {
    it("返回评测列表与好评率摘要", async () => {
      const result = await client.store.getAppReviews(440, { l: "schinese" });
      expect(result.success).toBe(1);
      expect(result.reviews.length).toBeGreaterThan(0);
      expect(result.query_summary.review_score_desc).toBe("Overwhelmingly Positive");
      expect(result.query_summary.total_reviews).toBe(2);
      const first = result.reviews[0];
      expect(first).toBeDefined();
      expect(first!.voted_up).toBe(true);
      expect(first!.author.steamid).toBeDefined();
      expect(result.cursor).toBeTruthy();
    });

    it("filter=all 翻页(cursor)不缓存", async () => {
      const first = await client.store.getAppReviews(440, { filter: "all", numPerPage: 10 });
      expect(first.reviews.length).toBe(2);
      const second = await client.store.getAppReviews(440, { filter: "all", cursor: first.cursor });
      expect(second.success).toBe(1);
    });
  });

  describe("redeemActivationKey 激活码兑换(写操作)", () => {
    it("未登录抛 LOGIN_REQUIRED", async () => {
      await expect(client.redeem.redeemActivationKey("AAA-BBB-CCC")).rejects.toMatchObject({
        code: "LOGIN_REQUIRED",
      });
    });

    it("登录后成功兑换(好 key)", async () => {
      await login();
      const result = await client.redeem.redeemActivationKey("GOOD-KEY-1234");
      expect(result.success).toBe(true);
      expect(result.result).toBe(0);
      expect(result.message).toContain("Team Fortress 2");
      expect(result.games).toContain("Team Fortress 2");
    });

    it("无效激活码返回失败结果码 14,不抛错", async () => {
      await login();
      const result = await client.redeem.redeemActivationKey("AAAAA-BBBBB-CCCCC-DDDDD");
      expect(result.success).toBe(false);
      expect(result.result).toBe(14);
      expect(result.message).toContain("无效");
    });

    it("兑换页 302 + Set-Cookie 会话刷新后拿到页面 sessionID(真实协议路径)", async () => {
      await login();
      // mock 的 registerkey 首访返回 302 + browserid Set-Cookie,SDK 吸收后重试。
      const result = await client.redeem.redeemActivationKey("GOOD-KEY-1234");
      expect(result.success).toBe(true);
      // registerkey GET 至少被访问(首访 302 + 吸收后 200)。
      expect(server.hits("/account/registerkey")).toBeGreaterThanOrEqual(1);
      expect(server.hits("/account/ajaxregisterkey/")).toBe(1);
    });
  });
});
