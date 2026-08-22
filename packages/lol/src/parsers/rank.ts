/**
 * 段位解析：把 LCU（queueMap）与 SGP（queues[]）两种格式规范化为统一结构。
 * 纯函数，无 IO。
 */

import type { RankedStats } from "../types.js";

export interface RankDetail {
  /** 空串表示未定级 */
  tier: string;
  /** "I"~"IV"，未定级为 "" */
  division: string;
  /** 胜点；缺失为 null */
  lp: number | null;
}

export interface RankSummary {
  solo: RankDetail;
  flex: RankDetail;
}

function normalizeDetail(raw: Record<string, unknown> | undefined): RankDetail {
  if (!raw) {
    return { tier: "", division: "", lp: null };
  }
  const tier = typeof raw.tier === "string" ? raw.tier : "";
  const division =
    typeof raw.division === "string" ? raw.division : typeof raw.rank === "string" ? raw.rank : "NA";
  return {
    tier,
    division: division === "NA" ? "" : division,
    lp: typeof raw.leaguePoints === "number" ? raw.leaguePoints : null,
  };
}

/** 解析 LCU `/lol-ranked/v1/ranked-stats/{puuid}` 返回值（queueMap + queues 结构） */
export function parseRankSummary(stats: RankedStats): RankSummary {
  const queueMap = (stats as { queueMap?: Record<string, unknown> }).queueMap ?? {};
  return {
    solo: normalizeDetail(queueMap["RANKED_SOLO_5x5"] as Record<string, unknown> | undefined),
    flex: normalizeDetail(queueMap["RANKED_FLEX_SR"] as Record<string, unknown> | undefined),
  };
}

/** 解析 SGP `/leagues-ledge/v2/rankedStats/puuid/{puuid}` 返回值（queues[] 结构） */
export function parseRankSummaryFromSgp(info: unknown): RankSummary {
  const queues = (info as { queues?: Array<Record<string, unknown>> })?.queues ?? [];
  const byType = new Map<string, Record<string, unknown>>();
  for (const queue of queues) {
    const type = queue.queueType;
    if (typeof type === "string") {
      byType.set(type, queue);
    }
  }
  return {
    solo: normalizeDetail(byType.get("RANKED_SOLO_5x5")),
    flex: normalizeDetail(byType.get("RANKED_FLEX_SR")),
  };
}
