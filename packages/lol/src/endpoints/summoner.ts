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

  /** 按游戏内名字搜索（LCU v1，旧 summonerName；Riot ID 用户请用 searchByRiotId） */
  getByName(name: string): Promise<Summoner> {
    return this.transport.request<Summoner>({
      method: "GET",
      path: `/lol-summoner/v1/summoners/name/${encodeURIComponent(name)}`,
    });
  }

  /** 按 Riot ID（gameName）搜索（LCU v2，POST 批量查询；返回匹配数组） */
  searchByRiotId(gameName: string): Promise<Summoner[]> {
    return this.transport.request<Summoner[]>({
      method: "POST",
      path: "/lol-summoner/v2/summoners/names",
      json: [gameName],
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
