/**
 * parsers 解析层：把 raw LCU/SGP JSON 转成友好的结构化数据（纯函数，无 IO）。
 */

export {
  parseMatchSummary,
  parseMatchesSummary,
  getRecentChampions,
  getTeammates,
  formatDuration,
  formatTimestamp,
} from "./match.js";
export type {
  MatchSummaryResult,
  ChampionStats,
  TeammatePlayer,
  TeammatesResult,
} from "./match.js";

export { parseRankSummary, parseRankSummaryFromSgp } from "./rank.js";
export type { RankDetail, RankSummary } from "./rank.js";
