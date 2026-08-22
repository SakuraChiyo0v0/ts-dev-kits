/**
 * 英雄名映射服务：id → 中文名。
 *
 * - 内置兜底表：BUILTIN_CHAMPION_NAMES（离线可用）
 * - 运行时自动更新：默认拉取 CommunityDragon latest 通道（与游戏/LCU 同源数据），
 *   出新英雄自动生效；TTL 缓存过期自动刷新，刷新失败静默回退内置表/旧缓存。
 */

import { Agent, fetch } from "undici";

import { BUILTIN_CHAMPION_NAMES } from "./data/champion-names.js";

export { BUILTIN_CHAMPION_NAMES };

export const DEFAULT_CHAMPION_SOURCE_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/champion-summary.json";

export interface ChampionNamesOptions {
  /** 数据源 URL（测试可注入本地地址），默认 CommunityDragon latest zh_cn */
  sourceUrl?: string;
  /** 缓存有效期（毫秒），默认 24 小时 */
  cacheTtlMs?: number;
  /** 请求超时（毫秒），默认 10s */
  timeoutMs?: number;
}

export type ChampionNameMap = Readonly<Record<number, string>>;

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;

interface RawChampion {
  id?: unknown;
  name?: unknown;
  alias?: unknown;
}

export class ChampionNamesService {
  private readonly sourceUrl: string;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly dispatcher: Agent;

  private map: ChampionNameMap = BUILTIN_CHAMPION_NAMES;
  private fetchedAt = 0;
  private inflight: Promise<void> | null = null;
  private closed = false;

  constructor(options: ChampionNamesOptions = {}) {
    this.sourceUrl = options.sourceUrl ?? DEFAULT_CHAMPION_SOURCE_URL;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.dispatcher = new Agent();
  }

  /** 当前生效的映射（内置或最近一次成功拉取的结果） */
  get currentMap(): ChampionNameMap {
    return this.map;
  }

  /** 获取映射；缓存过期时自动刷新 */
  async getMap(): Promise<ChampionNameMap> {
    if (this.isFresh()) {
      return this.map;
    }
    await this.refresh();
    return this.map;
  }

  /** 取单个英雄名（缓存过期时自动刷新） */
  async getName(id: number): Promise<string | undefined> {
    return (await this.getMap())[id];
  }

  /** 强制刷新映射；失败时保留现有映射（内置表或旧缓存），不抛错 */
  async refresh(): Promise<void> {
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private isFresh(): boolean {
    return this.fetchedAt > 0 && Date.now() - this.fetchedAt < this.cacheTtlMs;
  }

  private async doRefresh(): Promise<void> {
    if (this.closed) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.sourceUrl, {
        dispatcher: this.dispatcher,
        signal: controller.signal,
      });
      if (!response.ok) {
        return; // 静默回退
      }
      const list = (await response.json()) as RawChampion[];
      if (!Array.isArray(list)) {
        return; // 结构异常，静默回退
      }
      const next: Record<number, string> = {};
      for (const item of list) {
        if (
          typeof item.id === "number" &&
          item.id > 0 &&
          item.id < 5000 &&
          typeof item.name === "string" &&
          item.name.length > 0
        ) {
          next[item.id] = item.name;
        }
      }
      if (Object.keys(next).length === 0) {
        return; // 空表视为异常，静默回退
      }
      this.map = next;
      this.fetchedAt = Date.now();
    } catch {
      // 网络错误/超时：静默回退到内置表或旧缓存
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return; // 幂等
    }
    this.closed = true;
    await this.dispatcher.close();
  }
}
