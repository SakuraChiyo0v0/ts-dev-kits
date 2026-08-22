/**
 * 段位模块：ranked-stats（LCU 原生 + 国服 SGP）。
 */

import type { RankedStats } from "../types.js";
import type { LcuTransport } from "../transport.js";
import type { SgpApi } from "../sgp.js";

export class RankedApi {
  constructor(
    private readonly transport: LcuTransport,
    private readonly sgp: SgpApi | null,
  ) {}

  /** 段位统计（LCU 原生通道，全服可用） */
  getStats(puuid: string): Promise<RankedStats> {
    return this.transport.request<RankedStats>({
      method: "GET",
      path: `/lol-ranked/v1/ranked-stats/${encodeURIComponent(puuid)}`,
    });
  }

  /** 段位统计（SGP 通道，仅国服） */
  async getStatsViaSgp(puuid: string): Promise<RankedStats> {
    if (!this.sgp) {
      throw new Error("SGP 通道不可用：非腾讯国服服务器或未启用");
    }
    return this.sgp.getRankedStats(puuid);
  }
}
