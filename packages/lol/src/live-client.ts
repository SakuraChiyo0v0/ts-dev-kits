/**
 * Live Client Data API：游戏进行中时游戏进程在端口 2999 暴露的本地接口。
 * 与 LCU 不同：固定端口、明文 HTTP、无认证。只读、风险极低。
 */

import { Agent, fetch } from "undici";

import { LolError } from "./errors.js";

export interface LiveClientOptions {
  /** 覆盖默认地址 http://127.0.0.1:2999（测试用） */
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:2999";
const DEFAULT_TIMEOUT_MS = 5_000;

// ---------- 领域类型（宽松透传 + 关键字段） ----------

export interface ActivePlayer {
  abilities: {
    E: { abilityLevel: number; displayName: string; id: string; rawDescription: string; [key: string]: unknown };
    Passive: { displayName: string; id: string; rawDescription: string; [key: string]: unknown };
    Q: { abilityLevel: number; displayName: string; id: string; rawDescription: string; [key: string]: unknown };
    R: { abilityLevel: number; displayName: string; id: string; rawDescription: string; [key: string]: unknown };
    W: { abilityLevel: number; displayName: string; id: string; rawDescription: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  championStats: {
    abilityHaste: number;
    abilityPower: number;
    armor: number;
    attackDamage: number;
    attackSpeed: number;
    critChance: number;
    critDamage: number;
    currentHealth: number;
    currentMana: number;
    healShieldPower: number;
    healthRegenRate: number;
    [key: string]: unknown;
  };
  currentGold: number;
  fullRunes: { generalRunes: Array<Record<string, unknown>>; keystone: Record<string, unknown>; primaryRuneTree: Record<string, unknown>; secondaryRuneTree: Record<string, unknown>; [key: string]: unknown };
  level: number;
  summonerName: string;
  [key: string]: unknown;
}

export interface PlayerScore {
  assists: number;
  creepScore: number;
  deaths: number;
  kills: number;
  wardScore: number;
}

export interface PlayerInfo {
  championName: string;
  isBot: boolean;
  isDead: boolean;
  items: Array<Record<string, unknown>>;
  level: number;
  position: string;
  rawChampionName: string;
  respawnTimer: number;
  runes: { keystone: Record<string, unknown>; primaryRuneTree: Record<string, unknown>; secondaryRuneTree: Record<string, unknown>; [key: string]: unknown };
  scores: PlayerScore;
  summonerName: string;
  summonerSpells: { summonerSpellOne: Record<string, unknown>; summonerSpellTwo: Record<string, unknown>; [key: string]: unknown };
  team: string;
  [key: string]: unknown;
}

export interface GameStats {
  gameMode: string;
  gameTime: number;
  mapName: string;
  mapNumber: number;
  mapTerrain: string;
  [key: string]: unknown;
}

export interface GameEvent {
  EventID: number;
  EventName: string;
  EventTime: number;
  [key: string]: unknown;
}

export interface AllGameData {
  activePlayer: ActivePlayer;
  allPlayers: PlayerInfo[];
  events: { Events: GameEvent[] };
  gameData: GameStats;
  [key: string]: unknown;
}

export class LiveClientApi {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly dispatcher: Agent;
  private closed = false;

  constructor(options: LiveClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.dispatcher = new Agent();
  }

  // ---------- 全局端点 ----------

  /** 全场数据（所有玩家 + 事件 + 游戏信息） */
  getAllGameData(): Promise<AllGameData> {
    return this.getJson("/liveclientdata/allgamedata") as Promise<AllGameData>;
  }

  /** 玩家列表 */
  getPlayerList(): Promise<PlayerInfo[]> {
    return this.getJson("/liveclientdata/playerlist") as Promise<PlayerInfo[]>;
  }

  /** 当前玩家详情 */
  getActivePlayer(): Promise<ActivePlayer> {
    return this.getJson("/liveclientdata/activeplayer") as Promise<ActivePlayer>;
  }

  /** 当前玩家名（纯文本） */
  getActivePlayerName(): Promise<string> {
    return this.getText("/liveclientdata/activeplayername");
  }

  /** 游戏统计（模式/时间/地图） */
  getGameStats(): Promise<GameStats> {
    return this.getJson("/liveclientdata/gamestats") as Promise<GameStats>;
  }

  /** 事件流（击杀/推塔/拿龙等） */
  getEventData(): Promise<{ Events: GameEvent[] }> {
    return this.getJson("/liveclientdata/eventdata") as Promise<{ Events: GameEvent[] }>;
  }

  /** 当前玩家得分 */
  getScores(): Promise<PlayerScore> {
    return this.getJson("/liveclientdata/scores") as Promise<PlayerScore>;
  }

  /** 当前玩家物品 */
  getItems(): Promise<Array<Record<string, unknown>>> {
    return this.getJson("/liveclientdata/items") as Promise<Array<Record<string, unknown>>>;
  }

  /** 当前玩家技能（等级/CD） */
  getAbilities(): Promise<Record<string, unknown>> {
    return this.getJson("/liveclientdata/abilities") as Promise<Record<string, unknown>>;
  }

  /** 当前玩家符文 */
  getRunes(): Promise<Record<string, unknown>> {
    return this.getJson("/liveclientdata/runes") as Promise<Record<string, unknown>>;
  }

  // ---------- 按玩家子端点 ----------

  private playerPath(name: string, resource: string): string {
    return `/liveclientdata/player/${encodeURIComponent(name)}/${resource}`;
  }

  getPlayerScores(name: string): Promise<PlayerScore> {
    return this.getJson(this.playerPath(name, "scores")) as Promise<PlayerScore>;
  }

  getPlayerItems(name: string): Promise<Array<Record<string, unknown>>> {
    return this.getJson(this.playerPath(name, "items")) as Promise<Array<Record<string, unknown>>>;
  }

  getPlayerAbilities(name: string): Promise<Record<string, unknown>> {
    return this.getJson(this.playerPath(name, "abilities")) as Promise<Record<string, unknown>>;
  }

  getPlayerStats(name: string): Promise<Record<string, unknown>> {
    return this.getJson(this.playerPath(name, "stats")) as Promise<Record<string, unknown>>;
  }

  getPlayerChampionStats(name: string): Promise<Record<string, unknown>> {
    return this.getJson(this.playerPath(name, "championstats")) as Promise<Record<string, unknown>>;
  }

  getPlayerSummonerSpells(name: string): Promise<Record<string, unknown>> {
    return this.getJson(this.playerPath(name, "summonerspells")) as Promise<Record<string, unknown>>;
  }

  getPlayerRunes(name: string): Promise<Record<string, unknown>> {
    return this.getJson(this.playerPath(name, "runes")) as Promise<Record<string, unknown>>;
  }

  getPlayerFullRunes(name: string): Promise<Record<string, unknown>> {
    return this.getJson(this.playerPath(name, "fullrunes")) as Promise<Record<string, unknown>>;
  }

  // ---------- 内部 ----------

  private async request(path: string) {
    if (this.closed) {
      throw new LolError("CONNECTION", "Live Client 传输层已关闭");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        dispatcher: this.dispatcher,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LolError("TIMEOUT", `Live Client 请求超时: ${path}`, { cause: error });
      }
      throw new LolError("CONNECTION", `Live Client 请求失败: ${path}（游戏可能未在运行）`, {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await this.request(path);
    if (response.status === 404) {
      throw new LolError("NOT_FOUND", `Live Client 资源不存在: ${path}`);
    }
    if (!response.ok) {
      throw new LolError("UNKNOWN", `Live Client 返回错误状态 ${response.status}: ${path}`);
    }
    return (await response.json()) as unknown;
  }

  private async getText(path: string): Promise<string> {
    const response = await this.request(path);
    if (!response.ok) {
      throw new LolError("UNKNOWN", `Live Client 返回错误状态 ${response.status}: ${path}`);
    }
    return response.text();
  }

  async close(): Promise<void> {
    if (this.closed) {
      return; // 幂等
    }
    this.closed = true;
    await this.dispatcher.close();
  }
}

/** 创建 Live Client 客户端（游戏进行中时端口 2999 可用） */
export function createLiveClient(options: LiveClientOptions = {}): LiveClientApi {
  return new LiveClientApi(options);
}
