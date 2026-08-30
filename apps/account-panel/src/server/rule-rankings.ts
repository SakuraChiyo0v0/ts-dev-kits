/**
 * 番剧规则动态排名：把每个规则源的历史搜索成败、耗时、线路码率统计进 PG，
 * 按综合质量分降序排列，供搜索时优先使用高质量源。
 *
 * 表 rule_rankings：
 *   rule          TEXT PRIMARY KEY —— 规则名（如 7sefun / MXdm）
 *   searches      INTEGER —— 搜索尝试次数
 *   successes     INTEGER —— 搜索成功次数（有结果）
 *   latency_sum   BIGINT  —— 累计耗时 ms（算平均响应时长）
 *   bandwidth_sum BIGINT  —— 累计最高码率 bps（线路探测）
 *   probes        INTEGER —— 码率探测次数
 *   last_seen     TIMESTAMPTZ —— 最近一次活动
 *
 * 综合分 score（查询时计算，不落库）：
 *   success_rate(0~1) * 60 + 码率档(0~1) * 30 + 速度档(0~1) * 10
 *   —— 成功率为主，码率次之，响应速度加分。
 */
import { Pool } from "pg";
import { appLogger } from "./logger.js";

const pool: Pool | null =
  process.env.PG_URL !== undefined && process.env.PG_URL.trim() !== ""
    ? new Pool({ connectionString: process.env.PG_URL })
    : null;

if (pool !== null) {
  void (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS rule_rankings (
        rule TEXT PRIMARY KEY,
        searches INTEGER NOT NULL DEFAULT 0,
        successes INTEGER NOT NULL DEFAULT 0,
        latency_sum BIGINT NOT NULL DEFAULT 0,
        bandwidth_sum BIGINT NOT NULL DEFAULT 0,
        probes INTEGER NOT NULL DEFAULT 0,
        last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    } catch (error) {
      appLogger.error("rule_rankings 建表失败", { error });
    }
  })();
}

/** 记录一次搜索成败与耗时。 */
export async function recordRuleSearch(
  rule: string,
  ok: boolean,
  latencyMs: number,
): Promise<void> {
  if (pool === null) return;
  try {
    await pool.query(
      `INSERT INTO rule_rankings (rule, searches, successes, latency_sum, last_seen)
       VALUES ($1, 1, $2, $3, now())
       ON CONFLICT (rule) DO UPDATE SET
         searches = rule_rankings.searches + 1,
         successes = rule_rankings.successes + EXCLUDED.successes,
         latency_sum = rule_rankings.latency_sum + EXCLUDED.latency_sum,
         last_seen = now()`,
      [rule, ok ? 1 : 0, Math.max(0, Math.round(latencyMs))],
    );
  } catch (error) {
    appLogger.error("recordRuleSearch 失败", { rule, error });
  }
}

/** 记录一次线路码率探测（带宽 bps）。 */
export async function recordRuleBandwidth(rule: string, bandwidth: number): Promise<void> {
  if (pool === null || !Number.isFinite(bandwidth) || bandwidth <= 0) return;
  try {
    await pool.query(
      `INSERT INTO rule_rankings (rule, bandwidth_sum, probes, last_seen)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (rule) DO UPDATE SET
         bandwidth_sum = rule_rankings.bandwidth_sum + EXCLUDED.bandwidth_sum,
         probes = rule_rankings.probes + 1,
         last_seen = now()`,
      [rule, Math.round(bandwidth)],
    );
  } catch (error) {
    appLogger.error("recordRuleBandwidth 失败", { rule, error });
  }
}

/** 一条规则的排名统计。 */
export interface RuleRanking {
  rule: string;
  searches: number;
  successes: number;
  successRate: number;
  avgLatencyMs: number;
  avgBandwidth: number;
  /** 综合质量分 0~100。 */
  score: number;
}

/**
 * 查询全部规则的排名（按综合分降序）。无数据时返回空数组。
 * 综合分 = 成功率*60 + 码率档*30 + 速度档*10。
 */
export async function listRuleRankings(): Promise<RuleRanking[]> {
  if (pool === null) return [];
  try {
    const { rows } = await pool.query<{
      rule: string;
      searches: number;
      successes: number;
      latency_sum: string;
      bandwidth_sum: string;
      probes: number;
    }>(`SELECT rule, searches, successes, latency_sum, bandwidth_sum, probes
        FROM rule_rankings
        WHERE searches > 0 OR probes > 0`);
    const ranked = rows.map((row) => {
      const searches = Number(row.searches) || 0;
      const successes = Number(row.successes) || 0;
      const latencySum = Number(row.latency_sum) || 0;
      const bandwidthSum = Number(row.bandwidth_sum) || 0;
      const probes = Number(row.probes) || 0;
      const successRate = searches > 0 ? successes / searches : 0;
      const avgLatencyMs = searches > 0 ? latencySum / searches : 0;
      const avgBandwidth = probes > 0 ? bandwidthSum / probes : 0;
      // 码率档：0~8Mbps 线性映射到 0~1（>8Mbps 记满）。
      const bandwidthScore = Math.min(1, avgBandwidth / 8_000_000);
      // 速度档：>5s 记 0，<1s 记 1。
      const latencyScore = Math.max(0, Math.min(1, 1 - (avgLatencyMs - 1000) / 4000));
      const score = Math.round(successRate * 60 + bandwidthScore * 30 + latencyScore * 10);
      return {
        rule: row.rule,
        searches,
        successes,
        successRate: Math.round(successRate * 100) / 100,
        avgLatencyMs: Math.round(avgLatencyMs),
        avgBandwidth: Math.round(avgBandwidth),
        score,
      };
    });
    return ranked.sort((a, b) => b.score - a.score);
  } catch (error) {
    appLogger.error("listRuleRankings 失败", { error });
    return [];
  }
}

/** 按排名返回规则名数组（分数高的在前）；无排名数据时返回空数组。 */
export async function rankedRuleNames(): Promise<string[]> {
  const rankings = await listRuleRankings();
  return rankings.map((r) => r.rule);
}
