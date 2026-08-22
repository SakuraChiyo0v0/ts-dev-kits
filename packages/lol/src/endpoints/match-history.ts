/**
 * 战绩模块：战绩列表、对局详情。国服可用 SGP 通道获取更完整数据。
 */

import type { GameDetail, MatchHistoryGames, SgpMatchHistory } from "../types.js";
import type { LcuTransport } from "../transport.js";
import type { SgpApi } from "../sgp.js";

export interface MatchRange {
  begIndex?: number;
  endIndex?: number;
}

const DEFAULT_BEG = 0;
const DEFAULT_END = 19;

export class MatchHistoryApi {
  constructor(
    private readonly transport: LcuTransport,
    private readonly sgp: SgpApi | null,
  ) {}

  /**
   * 战绩列表（LCU 原生通道，全服可用）。
   * 返回 games 字段（含 gameCount 与 gameIndexBegin/End）。
   */
  async getMatches(puuid: string, range: MatchRange = {}): Promise<MatchHistoryGames> {
    const begIndex = range.begIndex ?? DEFAULT_BEG;
    const endIndex = range.endIndex ?? DEFAULT_END;
    const res = await this.transport.request<{ games?: MatchHistoryGames }>({
      method: "GET",
      path: `/lol-match-history/v1/products/lol/${encodeURIComponent(puuid)}/matches`,
      params: { begIndex, endIndex },
    });
    if (!res.games) {
      throw new Error("match history response missing games field");
    }
    return res.games;
  }

  /**
   * 战绩列表（SGP 通道，仅国服腾讯服务器）。
   * 返回 SGP SUMMARY 原始结构 { games: [...] }，每场为 metadata/info 格式
   * （与 LCU 的 participantIdentities/participants 结构不同，可另做映射）。
   */
  async getMatchesViaSgp(puuid: string, range: MatchRange = {}): Promise<SgpMatchHistory> {
    if (!this.sgp) {
      throw new Error("SGP 通道不可用：非腾讯国服服务器或未启用");
    }
    return this.sgp.getMatches(puuid, range);
  }

  /** 对局详情 */
  getGameDetail(gameId: number): Promise<GameDetail> {
    return this.transport.request<GameDetail>({
      method: "GET",
      path: `/lol-match-history/v1/games/${gameId}`,
    });
  }
}
