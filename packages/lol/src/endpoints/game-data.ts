/**
 * 游戏数据模块：静态数据（英雄/物品/符文/召唤师技能/队列/皮肤）与资源获取。
 */

import type { ChampionSummary, QueueInfo } from "../types.js";
import { LolError } from "../errors.js";
import type { LcuTransport } from "../transport.js";

export interface IconItem {
  id: number;
  iconPath: string;
  name: string;
  [key: string]: unknown;
}

export interface RuneItem {
  id: number;
  name: string;
  iconPath: string;
  longDesc: string;
  [key: string]: unknown;
}

export class GameDataApi {
  constructor(private readonly transport: LcuTransport) {}

  /** 英雄列表（摘要） */
  getChampions(): Promise<ChampionSummary[]> {
    return this.transport.request<ChampionSummary[]>({
      method: "GET",
      path: "/lol-game-data/assets/v1/champion-summary.json",
    });
  }

  /** 物品列表 */
  getItems(): Promise<IconItem[]> {
    return this.transport.request<IconItem[]>({
      method: "GET",
      path: "/lol-game-data/assets/v1/items.json",
    });
  }

  /** 召唤师技能列表 */
  getSummonerSpells(): Promise<IconItem[]> {
    return this.transport.request<IconItem[]>({
      method: "GET",
      path: "/lol-game-data/assets/v1/summoner-spells.json",
    });
  }

  /** 符文列表（perks.json） */
  getRunes(): Promise<RuneItem[]> {
    return this.transport.request<RuneItem[]>({
      method: "GET",
      path: "/lol-game-data/assets/v1/perks.json",
    });
  }

  /** 队列信息 */
  getQueues(): Promise<QueueInfo[]> {
    return this.transport.request<QueueInfo[]>({
      method: "GET",
      path: "/lol-game-queues/v1/queues",
    });
  }

  /** 获取资源文件（图标/原画等，iconPath 形如 /lol-game-data/assets/...） */
  async fetchAsset(iconPath: string): Promise<Buffer> {
    const raw = await this.transport.requestRaw({
      method: "GET",
      path: iconPath,
    });
    if (raw.status >= 400) {
      throw new LolError("NOT_FOUND", `资源不存在: ${iconPath}`, { cause: raw });
    }
    if (Buffer.isBuffer(raw.body)) {
      return raw.body;
    }
    throw new Error(`asset ${iconPath} did not return binary data`);
  }
}
