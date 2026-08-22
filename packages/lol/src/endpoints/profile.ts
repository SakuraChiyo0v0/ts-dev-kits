/**
 * 生涯/个性化设置模块（P4）：主页背景、头像、段位展示、勋章、头像框。
 */

import type { LcuTransport } from "../transport.js";

export type RankedTier =
  | "UNRANKED"
  | "IRON"
  | "BRONZE"
  | "SILVER"
  | "GOLD"
  | "PLATINUM"
  | "DIAMOND"
  | "MASTER"
  | "GRANDMASTER"
  | "CHALLENGER";

export interface RankShown {
  queue: string;
  tier: RankedTier;
  division: string;
}

export class ProfileApi {
  constructor(private readonly transport: LcuTransport) {}

  /** 修改个人主页背景（皮肤原画） */
  setBackground(skinId: number): Promise<void> {
    return this.transport.request<void>({
      method: "POST",
      path: "/lol-summoner/v1/current-summoner/summoner-profile",
      json: { key: "backgroundSkinId", value: skinId },
    });
  }

  /** 修改主页背景的签名特效（名人堂皮肤 augment） */
  setBackgroundAugments(contentId: string): Promise<void> {
    return this.transport.request<void>({
      method: "POST",
      path: "/lol-summoner/v1/current-summoner/summoner-profile",
      json: { key: "backgroundSkinAugments", value: contentId },
    });
  }

  /** 修改头像 */
  setProfileIcon(iconId: number): Promise<void> {
    return this.transport.request<void>({
      method: "PUT",
      path: "/lol-summoner/v1/current-summoner/icon",
      json: { profileIconId: iconId },
    });
  }

  /** 状态卡片段位展示 */
  setRankShown(queue: string, tier: RankedTier, division: string): Promise<void> {
    return this.transport.request<void>({
      method: "PUT",
      path: "/lol-chat/v1/me",
      json: {
        lol: {
          rankedLeagueQueue: queue,
          rankedLeagueTier: tier,
          rankedLeagueDivision: division,
        },
      },
    });
  }

  /** 一键卸下所有勋章（保留当前横幅配色） */
  async removeTokens(): Promise<void> {
    const me = await this.transport.request<{ lol?: { bannerIdSelected?: number } }>({
      method: "GET",
      path: "/lol-chat/v1/me",
    });
    await this.transport.request<void>({
      method: "POST",
      path: "/lol-challenges/v1/update-player-preferences/",
      json: {
        challengeIds: [],
        bannerAccent: me.lol?.bannerIdSelected ?? 0,
      },
    });
  }

  /** 一键卸下头像框（Prestige Crest） */
  async removePrestigeCrest(): Promise<void> {
    const regalia = await this.transport.request<{ preferredBannerType?: string }>({
      method: "GET",
      path: "/lol-regalia/v2/current-summoner/regalia",
    });
    await this.transport.request<void>({
      method: "PUT",
      path: "/lol-regalia/v2/current-summoner/regalia",
      json: {
        preferredCrestType: "prestige",
        preferredBannerType: regalia.preferredBannerType ?? "",
        selectedPrestigeCrest: 22,
      },
    });
  }
}
