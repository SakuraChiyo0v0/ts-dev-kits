/**
 * 番剧规则动态排名：把每个规则源的历史搜索成败、耗时、线路码率、下载成败与下载速率
 * 统计进 PG，按综合质量分降序排列，供搜索时优先使用高质量源。
 *
 * 表 rule_rankings：
 *   rule                TEXT PRIMARY KEY —— 规则名（如 7sefun / MXdm）
 *   searches            INTEGER —— 搜索尝试次数
 *   successes           INTEGER —— 搜索成功次数（有结果）
 *   latency_sum         BIGINT  —— 搜索累计耗时 ms（算平均响应时长）
 *   bandwidth_sum       BIGINT  —— 线路探测累计最高码率 bps
 *   probes              INTEGER —— 码率探测次数
 *   downloads           INTEGER —— 下载尝试次数
 *   download_successes  INTEGER —— 下载成功次数
 *   speed_sum           BIGINT  —— 下载累计速率 bps（ffprobe 实测视频码率）
 *   probe_failures      INTEGER —— 线路质量探测失败次数（加密源/JS 动态取流，无法解析播放）
 *   last_seen           TIMESTAMPTZ —— 最近一次活动
 *
 * 综合分 score（查询时计算，不落库，满分 100）：
 *   搜索成功率*50 + 下载成功率*20 + 平均码率档*20 + 下载速率档*5 + 搜索速度档*5
 *   - 可播放性惩罚：探测失败（加密源）每 2 次 -5 分（最多 -20），避免加密源排前被优先点到。
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
        downloads INTEGER NOT NULL DEFAULT 0,
        download_successes INTEGER NOT NULL DEFAULT 0,
        speed_sum BIGINT NOT NULL DEFAULT 0,
        probe_failures INTEGER NOT NULL DEFAULT 0,
        last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      // 老表缺新字段时补列（幂等）。
      await pool.query(`ALTER TABLE rule_rankings ADD COLUMN IF NOT EXISTS downloads INTEGER NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE rule_rankings ADD COLUMN IF NOT EXISTS download_successes INTEGER NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE rule_rankings ADD COLUMN IF NOT EXISTS speed_sum BIGINT NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE rule_rankings ADD COLUMN IF NOT EXISTS probe_failures INTEGER NOT NULL DEFAULT 0`);
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

/**
 * 记录一次下载成败与下载速率（bps，ffprobe 实测视频码率）。
 * 用于排名中「下载成功率」与「下载速率」两个维度。
 */
export async function recordRuleDownload(
  rule: string,
  ok: boolean,
  speedBps: number,
): Promise<void> {
  if (pool === null) return;
  const speed = Number.isFinite(speedBps) && speedBps > 0 ? Math.round(speedBps) : 0;
  try {
    await pool.query(
      `INSERT INTO rule_rankings (rule, downloads, download_successes, speed_sum, last_seen)
       VALUES ($1, 1, $2, $3, now())
       ON CONFLICT (rule) DO UPDATE SET
         downloads = rule_rankings.downloads + 1,
         download_successes = rule_rankings.download_successes + EXCLUDED.download_successes,
         speed_sum = rule_rankings.speed_sum + EXCLUDED.speed_sum,
         last_seen = now()`,
      [rule, ok ? 1 : 0, speed],
    );
  } catch (error) {
    appLogger.error("recordRuleDownload 失败", { rule, error });
  }
}

/**
 * 记录一次线路质量探测失败（加密源 / JS 动态取流 / 播放页解析失败）。
 * 这类源播放与下载都不可用，累计后降低其排名，避免排前被优先点到。
 */
export async function recordRuleProbeFailure(rule: string): Promise<void> {
  if (pool === null) return;
  try {
    await pool.query(
      `INSERT INTO rule_rankings (rule, probe_failures, last_seen)
       VALUES ($1, 1, now())
       ON CONFLICT (rule) DO UPDATE SET
         probe_failures = rule_rankings.probe_failures + 1,
         last_seen = now()`,
      [rule],
    );
  } catch (error) {
    appLogger.error("recordRuleProbeFailure 失败", { rule, error });
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
  /** 下载次数 / 成功次数 / 下载成功率。 */
  downloads: number;
  downloadSuccesses: number;
  downloadSuccessRate: number;
  /** 平均下载速率 bps（ffprobe 实测）。 */
  avgSpeed: number;
  /** 综合质量分 0~100。 */
  score: number;
}

/**
 * 查询全部规则的排名（按综合分降序）。无数据时返回空数组。
 * 综合分 = 搜索成功率*50 + 下载成功率*20 + 平均码率档*20 + 下载速率档*5 + 搜索速度档*5。
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
      downloads: number;
      download_successes: number;
      speed_sum: string;
      probe_failures: number;
    }>(`SELECT rule, searches, successes, latency_sum, bandwidth_sum, probes,
              downloads, download_successes, speed_sum, probe_failures
        FROM rule_rankings
        WHERE searches > 0 OR probes > 0 OR downloads > 0 OR probe_failures > 0`);
    const ranked = rows.map((row) => {
      const searches = Number(row.searches) || 0;
      const successes = Number(row.successes) || 0;
      const latencySum = Number(row.latency_sum) || 0;
      const bandwidthSum = Number(row.bandwidth_sum) || 0;
      const probes = Number(row.probes) || 0;
      const successRate = searches > 0 ? successes / searches : 0;
      const avgLatencyMs = searches > 0 ? latencySum / searches : 0;
      const avgBandwidth = probes > 0 ? bandwidthSum / probes : 0;
      const downloads = Number(row.downloads) || 0;
      const downloadSuccesses = Number(row.download_successes) || 0;
      const speedSum = Number(row.speed_sum) || 0;
      const downloadSuccessRate = downloads > 0 ? downloadSuccesses / downloads : 0;
      const avgSpeed = downloads > 0 ? speedSum / downloads : 0;
      // 码率档：0~8Mbps 线性映射到 0~1（>8Mbps 记满）。
      const bandwidthScore = Math.min(1, avgBandwidth / 8_000_000);
      // 下载速率档：0~10Mbps 线性映射到 0~1（>10Mbps 记满，用下载实测码率）。
      const speedScore = Math.min(1, avgSpeed / 10_000_000);
      // 搜索速度档：>5s 记 0，<1s 记 1。
      const latencyScore = Math.max(0, Math.min(1, 1 - (avgLatencyMs - 1000) / 4000));
      // 综合分：搜索成功率为主(50)，下载成功率(20)、画质码率(20)次之，下载速率(5)、搜索速度(5)加分。
      let score = Math.round(
        successRate * 50 +
        downloadSuccessRate * 20 +
        bandwidthScore * 20 +
        speedScore * 5 +
        latencyScore * 5,
      );
      // 可播放性惩罚：探测失败（加密源/JS 取流）每 2 次 -5 分，最多 -20，避免排前被优先点到。
      const probeFailures = Number(row.probe_failures) || 0;
      score -= Math.min(20, Math.floor(probeFailures / 2) * 5);
      score = Math.max(0, score);
      return {
        rule: row.rule,
        searches,
        successes,
        successRate: Math.round(successRate * 100) / 100,
        avgLatencyMs: Math.round(avgLatencyMs),
        avgBandwidth: Math.round(avgBandwidth),
        downloads,
        downloadSuccesses,
        downloadSuccessRate: Math.round(downloadSuccessRate * 100) / 100,
        avgSpeed: Math.round(avgSpeed),
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
