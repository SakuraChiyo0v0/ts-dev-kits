import { join } from "node:path";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolveConfigRoot } from "@sakurachiyo0v0/config";
import { RuleLoader, ruleFromJson, validateRule } from "./rules/loader.js";
import { RuleSync } from "./rules/sync.js";
import { RuleEngine, type ChapterTrace, type SearchTrace } from "./engine/engine.js";
import { DefaultRuleRequestExecutor } from "./request/executor.js";
import { EpisodeDownloader } from "./stream/download.js";
import { KazumiError } from "./errors.js";
import type {
  AnimeClientOptions,
  AnimeRule,
  DownloadProgress,
  Episode,
  Road,
  SearchItem,
} from "./types.js";

export { resolveConfigRoot };

/** 默认规则目录:<配置根>/amechan/kazumi/rules/。 */
export function defaultRulesDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveConfigRoot(platform, env), "amechan", "kazumi", "rules");
}

/** 规则管理器。 */
export interface RuleManager {
  /** 列出全部规则名(本地规则目录 *.json,含已缓存的远端规则)。 */
  list(): string[];
  /** 加载单条规则(不存在抛 RULE_NOT_FOUND;sync 开启时优先远端并缓存)。 */
  load(name: string): Promise<AnimeRule>;
  /** 校验规则 JSON 合法性,返回错误列表(空 = 合法)。 */
  validateJson(json: Record<string, unknown>): string[];
  /** 导入规则(校验通过后本地 + WebDAV 双写),返回规则名。 */
  add(json: Record<string, unknown>): Promise<string>;
  /** 删除规则(本地 + WebDAV 双删,不存在抛 RULE_NOT_FOUND)。 */
  remove(name: string): Promise<void>;
}

/** kazumi SDK 客户端门面。 */
export interface AnimeClient {
  rules: RuleManager;
  /** 按关键词搜索(打全部规则或指定规则),结果带 [规则名] 前缀。 */
  search(keyword: string, opts?: { rules?: string[] }): Promise<SearchItem[]>;
  /** 流式搜索:每搜到一个源的结果就回调一次(搜到一个返回一个),支持中途取消与进度上报。 */
  searchStream(
    keyword: string,
    opts: {
      onBatch: (items: SearchItem[]) => void;
      signal?: AbortSignal;
      rules?: string[];
      /** 进度回调:每完成一个源调用一次(done 已尝试数 / total 规则总数),用于 UI 展示「已搜 n/m 源」。 */
      onProgress?: (done: number, total: number) => void;
    },
  ): Promise<SearchItem[]>;
  /** 按搜索结果查线路。 */
  getRoads(item: SearchItem): Promise<Road[]>;
  /** 线路 → 集数列表。 */
  getEpisodes(item: SearchItem, road: Road): Promise<Episode[]>;
  /** 下载单集 mp4。 */
  download(
    episode: Episode,
    opts: {
      outputDir: string;
      rule: string;
      adFilter?: boolean;
      onProgress?: (progress: DownloadProgress) => void;
    },
  ): Promise<{ filePath: string }>;
  /** 规则调试:单规则搜索,返回原始响应与匹配片段。 */
  traceSearch(ruleName: string, keyword: string): Promise<SearchTrace>;
  /** 规则调试:单规则章节查询,返回原始响应与线路。 */
  traceChapters(ruleName: string, source: string): Promise<ChapterTrace>;
}

/** 创建 kazumi 客户端。 */
export function createAnimeClient(options: AnimeClientOptions = {}): AnimeClient {
  const rulesDir = options.rulesDir ?? defaultRulesDir();
  const sync = new RuleSync(options.sync === true);
  const loader = new RuleLoader(rulesDir, sync);
  const engine = new RuleEngine(
    options.fetchImpl ? new DefaultRuleRequestExecutor(options.fetchImpl) : undefined,
  );
  // 会话级失效源黑名单：一次会话内失败的源跨多次搜索复用跳过。
  // 实现：连续失败计数 + TTL 过期（默认 10 分钟），避免单次瞬时抖动把可用源永久拉黑
  // 到容器重启（超时收敛到 6s 后该问题会更明显）。
  // 失效源随站点维护会变化，跨会话/重启不持久化（重启后重新探测）。
  const deadRules = new Map<string, { failures: number; blockedUntil: number | null }>();
  const DEAD_RULE_FAIL_THRESHOLD = 2; // 连续失败 N 次才拉黑
  const DEAD_RULE_TTL_MS = 10 * 60 * 1000; // 拉黑后 10 分钟过期

  /** 规则是否当前被拉黑（未拉黑 / 已过期自动放行）。 */
  function isDeadRule(name: string): boolean {
    const entry = deadRules.get(name);
    if (entry === undefined) return false;
    // 未达阈值（failures < 阈值，blockedUntil 为 null）：只累计计数，不算拉黑。
    if (entry.blockedUntil === null) return false;
    if (Date.now() >= entry.blockedUntil) {
      deadRules.delete(name);
      return false;
    }
    return true;
  }

  /** 记录一次规则失败；连续失败达到阈值才拉黑（带 TTL）。 */
  function markRuleFailed(name: string): void {
    const prev = deadRules.get(name);
    const failures = (prev?.failures ?? 0) + 1;
    if (failures >= DEAD_RULE_FAIL_THRESHOLD) {
      deadRules.set(name, { failures, blockedUntil: Date.now() + DEAD_RULE_TTL_MS });
    } else {
      deadRules.set(name, { failures, blockedUntil: null });
    }
  }

  const rules: RuleManager = {
    list: () => loader.list(),
    load: async (name: string) => loader.load(name),
    validateJson: (json: Record<string, unknown>) => {
      try {
        const name = String(json["name"] ?? "");
        if (name === "") return ["规则缺少 name"];
        return validateRule(ruleFromJson(name, json));
      } catch (error) {
        return [(error as Error).message];
      }
    },
    add: async (json: Record<string, unknown>) => {
      const name = String(json["name"] ?? "");
      if (name === "") {
        throw new KazumiError("RULE_INVALID", "规则缺少 name");
      }
      const errors = validateRule(ruleFromJson(name, json));
      if (errors.length > 0) {
        throw new KazumiError("RULE_INVALID", `规则校验失败: ${errors.join("; ")}`);
      }
      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(join(rulesDir, `${name}.json`), JSON.stringify(json, null, 2), "utf-8");
      // 远端双写(WebDAV 同步;失败不阻塞,本地已保存)。
      await sync.put(name, json);
      return name;
    },
    remove: async (name: string) => {
      try {
        unlinkSync(join(rulesDir, `${name}.json`));
      } catch (error) {
        throw new KazumiError(
          "RULE_NOT_FOUND",
          `规则不存在: ${name}`,
          error instanceof Error ? error : undefined,
        );
      }
      // 远端双删(失败不阻塞)。
      await sync.remove(name);
    },
  };

  async function resolveRules(opts?: { rules?: string[] }): Promise<AnimeRule[]> {
    if (opts?.rules && opts.rules.length > 0) {
      const rulesList: AnimeRule[] = [];
      for (const name of opts.rules) {
        rulesList.push(await loader.load(name));
      }
      return rulesList;
    }
    // 同步开启时先拉远端规则缓存到本地,再取本地清单。
    if (sync.enabled) {
      await loader.listRemote();
    }
    const names = loader.list();
    if (names.length === 0) {
      throw new KazumiError(
        "RULE_NOT_FOUND",
        `规则目录为空: ${rulesDir}。请先配置规则(sc-kazumi rules add)`,
      );
    }
    const rulesList: AnimeRule[] = [];
    for (const name of names) {
      try {
        rulesList.push(await loader.load(name));
      } catch {
        // 单个规则损坏/失效（校验失败、JSON 解析失败等）：跳过，不拖垮整体搜索。
      }
    }
    return rulesList;
  }

  return {
    rules,

    async search(keyword: string, opts?: { rules?: string[] }): Promise<SearchItem[]> {
      const all: SearchItem[] = [];
      await this.searchStream(keyword, {
        onBatch: (items) => all.push(...items),
        ...(opts?.rules !== undefined ? { rules: opts.rules } : {}),
      });
      return all;
    },

    async searchStream(
      keyword: string,
      opts: {
        onBatch: (items: SearchItem[]) => void;
        signal?: AbortSignal;
        rules?: string[];
        /** 进度回调：每完成一个源调用一次（含被黑名单跳过的），用于前端展示「已搜 n/m 源」。 */
        onProgress?: (done: number, total: number) => void;
      },
    ): Promise<SearchItem[]> {
      const ruleList = await resolveRules(opts);
      const results: SearchItem[] = [];
      let captchaBlocked = false;
      // 并发搜索：12 路并发 + 结果早停（收集到足够结果就提前结束慢源等待）。
      // 流式回调：每搜到一个源的结果立即 onBatch，用户无需等全部渠道返回。
      const CONCURRENCY = 12;
      const EARLY_STOP_COUNT = 40;
      let next = 0;
      let stopped = false;
      let doneCount = 0;
      const checkAbort = () => {
        if (opts.signal?.aborted === true) {
          stopped = true;
          return true;
        }
        return false;
      };
      const total = ruleList.length;
      const reportProgress = () => {
        opts.onProgress?.(doneCount, total);
      };
      async function worker(): Promise<void> {
        while (true) {
          if (stopped) return;
          const index = next;
          next += 1;
          if (index >= ruleList.length) return;
          const rule = ruleList[index];
          if (rule === undefined) return;
          if (isDeadRule(rule.name)) {
            // 黑名单跳过也算「已尝试」，进度照常推进。
            doneCount += 1;
            reportProgress();
            continue;
          }
          try {
            const trace = await engine.search(rule, keyword);
            if (stopped || checkAbort()) return;
            const batch = trace.items.map((item) => ({
              name: `[${rule.name}] ${item.name}`,
              src: item.src,
            }));
            results.push(...batch);
            // 搜到一个源就立刻推给调用方（前端实时渲染）。
            opts.onBatch(batch);
            if (results.length >= EARLY_STOP_COUNT) {
              // 已收集到足够结果：通知其他 worker 停止等待慢源。
              stopped = true;
            }
          } catch (error) {
            // 单个规则失败（验证码/无结果/网络错误/解析错误）不影响整体：跳过该规则，
            // 并累计失败计数——连续失败达阈值才拉黑（TTL 过期自动放行），
            // 避免单次瞬时抖动把可用源永久拉黑到容器重启。
            markRuleFailed(rule.name);
            if (error instanceof KazumiError && error.code === "CAPTCHA") {
              captchaBlocked = true;
            }
          } finally {
            // 无论成功失败都推进进度（早停时可能来不及逐源上报，只上报已完成的）。
            if (!stopped) {
              doneCount += 1;
              reportProgress();
            }
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, ruleList.length) }, () => worker()),
      );
      reportProgress();
      // 全部规则都被验证码挡住 → 明确报 CAPTCHA,而不是空结果
      if (results.length === 0 && captchaBlocked) {
        throw new KazumiError("CAPTCHA", "搜索被验证码拦截(全部规则均需验证码)");
      }
      return results;
    },

    async getRoads(item: SearchItem): Promise<Road[]> {
      const rule = await inferRule(item, loader);
      const trace = await engine.queryChapters(rule, item.src);
      return trace.roads;
    },

    async getEpisodes(item: SearchItem, road: Road): Promise<Episode[]> {
      const rule = await inferRule(item, loader);
      void rule;
      return road.data.map((url, index) => ({
        name: road.identifier[index] ?? `第${index + 1}集`,
        url,
      }));
    },

    async download(
      episode: Episode,
      opts: {
        outputDir: string;
        rule: string;
        adFilter?: boolean;
        onProgress?: (progress: DownloadProgress) => void;
      },
    ): Promise<{ filePath: string }> {
      const rule = await loader.load(opts.rule);
      const downloader = new EpisodeDownloader(options.fetchImpl, {
        ...options.download,
        ...(opts.adFilter !== undefined ? { adFilter: opts.adFilter } : {}),
      });
      return downloader.download(rule, episode, {
        outputDir: opts.outputDir,
        ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      });
    },

    async traceSearch(ruleName: string, keyword: string): Promise<SearchTrace> {
      const rule = await loader.load(ruleName);
      return engine.search(rule, keyword);
    },

    async traceChapters(ruleName: string, source: string): Promise<ChapterTrace> {
      const rule = await loader.load(ruleName);
      return engine.queryChapters(rule, source);
    },
  };
}

/** 从搜索结果推断所属规则(名称 [规则名] 前缀优先,否则按 baseUrl 匹配)。 */
async function inferRule(item: SearchItem, loader: RuleLoader): Promise<AnimeRule> {
  const match = item.name.match(/^\[([^\]]+)\]/);
  if (match?.[1]) {
    try {
      return await loader.load(match[1]);
    } catch {
      // 前缀规则不存在时走 URL 匹配
    }
  }
  for (const name of loader.list()) {
    const rule = await loader.load(name);
    if (item.src.startsWith(rule.baseUrl)) {
      return rule;
    }
  }
  throw new KazumiError("RULE_NOT_FOUND", `无法确定结果 ${item.name} 所属规则`);
}
