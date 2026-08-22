/**
 * 召唤师模块：当前召唤师、搜索、资料页、头像。
 */

import type { CurrentSummoner, Summoner } from "../types.js";
import type { LcuTransport } from "../transport.js";

export interface SummonerProfile {
  items: unknown[];
  key: string;
  value: unknown;
  [key: string]: unknown;
}

export class SummonerApi {
  constructor(private readonly transport: LcuTransport) {}

  /** 当前登录召唤师 */
  getCurrent(): Promise<CurrentSummoner> {
    return this.transport.request<CurrentSummoner>({
      method: "GET",
      path: "/lol-summoner/v1/current-summoner",
    });
  }

  /** 按游戏内名字搜索（同大区） */
  getByName(name: string): Promise<Summoner> {
    return this.transport.request<Summoner>({
      method: "GET",
      path: "/lol-summoner/v1/summoners",
      params: { name },
    });
  }

  /** 按 PUUID 查询 */
  getByPuuid(puuid: string): Promise<Summoner> {
    return this.transport.request<Summoner>({
      method: "GET",
      path: `/lol-summoner/v2/summoners/puuid/${encodeURIComponent(puuid)}`,
    });
  }

  /** 当前召唤师资料页（主页背景等） */
  getProfile(): Promise<SummonerProfile> {
    return this.transport.request<SummonerProfile>({
      method: "GET",
      path: "/lol-summoner/v1/current-summoner/summoner-profile",
    });
  }
}
