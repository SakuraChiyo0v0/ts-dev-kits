/**
 * 腾讯国服 SGP 通道（https://{server}-sgp.lol.qq.com:21019）。
 * 战绩/段位/观战数据在国服走此通道，海外服无此通道。
 */

import { Agent, fetch } from "undici";

import { LolError } from "./errors.js";
import type { RankedStats, SgpMatchHistory } from "./types.js";

export interface SgpOptions {
  server: string;
  /** 获取 SGP access token（通常来自 LCU /entitlements/v1/token） */
  getToken: () => Promise<string>;
  timeoutMs?: number;
}

export interface SgpMatchRange {
  begIndex?: number;
  endIndex?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** 腾讯 SGP 网关地址（hn1/hn10/bgp2 走 k8s 前缀） */
export function sgpBaseUrl(server: string): string {
  const s = server.toLowerCase();
  if (s === "hn1" || s === "hn10" || s === "bgp2") {
    return `https://${s}-k8s-sgp.lol.qq.com:21019`;
  }
  return `https://${s}-sgp.lol.qq.com:21019`;
}

export class SgpApi {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly dispatcher: Agent;
  private closed = false;

  constructor(private readonly options: SgpOptions) {
    this.baseUrl = sgpBaseUrl(options.server);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.dispatcher = new Agent({
      connect: { rejectUnauthorized: false },
    });
  }

  /** 战绩列表（SUMMARY，返回含 gameList 数组的原始结构） */
  async getMatches(puuid: string, range: SgpMatchRange = {}): Promise<SgpMatchHistory> {
    const begIndex = range.begIndex ?? 0;
    const endIndex = range.endIndex ?? 19;
    return this.get(`/match-history-query/v1/products/lol/player/${puuid}/SUMMARY`, {
      startIndex: begIndex,
      count: endIndex - begIndex + 1,
    }) as Promise<SgpMatchHistory>;
  }

  /** 段位统计 */
  async getRankedStats(puuid: string): Promise<RankedStats> {
    return this.get(`/leagues-ledge/v2/rankedStats/puuid/${puuid}`) as Promise<RankedStats>;
  }

  /** 按 PUUID 查召唤师（无 tagLine） */
  async getSummonerByPuuid(puuid: string): Promise<unknown> {
    return this.get(`/summoner-ledge/v1/regions/${this.options.server.toLowerCase()}/summoners/puuid/${puuid}`);
  }

  /** 观战信息（玩家是否在游戏中） */
  async getSpectatorInfo(puuid: string): Promise<unknown> {
    return this.get(`/gsm/v1/ledge/spectator/region/${this.options.server.toLowerCase()}/puuid/${puuid}`);
  }

  private async get(path: string, params?: Record<string, string | number>): Promise<unknown> {
    const token = await this.options.getToken();
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        dispatcher: this.dispatcher,
        signal: controller.signal,
      });
      const body = (await response.json()) as { errorCode?: string; httpStatus?: number };

      if (body.errorCode || body.httpStatus) {
        if (body.httpStatus === 404 || body.errorCode === "NOT_FOUND") {
          throw new LolError("NOT_FOUND", `SGP 资源不存在: ${path}`, { cause: body });
        }
        throw new LolError("UNKNOWN", `SGP 返回错误: ${path}`, { cause: body });
      }
      return body;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LolError("TIMEOUT", `SGP 请求超时: ${path}`, { cause: error });
      }
      throw error;
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
