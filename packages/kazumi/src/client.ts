import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { RuleLoader, ruleFromJson, validateRule } from "./rules/loader.js";
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

/** 平台标准用户配置根目录(与 account 包 resolveConfigRoot 逻辑一致)。 */
export function resolveConfigRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.AMECHAN_CONFIG_HOME;
  if (explicit !== undefined && explicit !== "") {
    return explicit;
  }
  if (platform === "win32") {
    const appData = env.APPDATA;
    if (appData !== undefined && appData !== "") {
      return appData;
    }
    return join(homedir(), "AppData", "Roaming");
  }
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support");
  }
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg !== undefined && xdg !== "") {
    return xdg;
  }
  return join(homedir(), ".config");
}

/** 默认规则目录:<配置根>/amechan/kazumi/rules/。 */
export function defaultRulesDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveConfigRoot(platform, env), "amechan", "kazumi", "rules");
}

/** 规则管理器。 */
export interface RuleManager {
  /** 列出全部规则名(规则目录下 *.json 文件名)。 */
  list(): string[];
  /** 加载单条规则(不存在抛 RULE_NOT_FOUND)。 */
  load(name: string): AnimeRule;
  /** 校验规则 JSON 合法性,返回错误列表(空 = 合法)。 */
  validateJson(json: Record<string, unknown>): string[];
  /** 导入规则 JSON 到规则目录(校验通过后写入),返回规则名。 */
  add(json: Record<string, unknown>): string;
  /** 删除规则文件(不存在抛 RULE_NOT_FOUND)。 */
  remove(name: string): void;
}

/** kazumi SDK 客户端门面。 */
export interface AnimeClient {
  rules: RuleManager;
  /** 按关键词搜索(打全部规则或指定规则),结果带 [规则名] 前缀。 */
  search(keyword: string, opts?: { rules?: string[] }): Promise<SearchItem[]>;
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
  const loader = new RuleLoader(rulesDir);
  const engine = new RuleEngine(
    options.fetchImpl ? new DefaultRuleRequestExecutor(options.fetchImpl) : undefined,
  );

  const rules: RuleManager = {
    list: () => loader.list(),
    load: (name: string) => loader.load(name),
    validateJson: (json: Record<string, unknown>) => {
      try {
        const name = String(json["name"] ?? "");
        if (name === "") return ["规则缺少 name"];
        return validateRule(ruleFromJson(name, json));
      } catch (error) {
        return [(error as Error).message];
      }
    },
    add: (json: Record<string, unknown>) => {
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
      return name;
    },
    remove: (name: string) => {
      try {
        unlinkSync(join(rulesDir, `${name}.json`));
      } catch (error) {
        throw new KazumiError(
          "RULE_NOT_FOUND",
          `规则不存在: ${name}`,
          error instanceof Error ? error : undefined,
        );
      }
    },
  };

  function resolveRules(opts?: { rules?: string[] }): AnimeRule[] {
    if (opts?.rules && opts.rules.length > 0) {
      return opts.rules.map((name) => loader.load(name));
    }
    const names = loader.list();
    if (names.length === 0) {
      throw new KazumiError(
        "RULE_NOT_FOUND",
        `规则目录为空: ${rulesDir}。请先配置规则(sc-kazumi rules add)`,
      );
    }
    return names.map((name) => loader.load(name));
  }

  return {
    rules,

    async search(keyword: string, opts?: { rules?: string[] }): Promise<SearchItem[]> {
      const ruleList = resolveRules(opts);
      const results: SearchItem[] = [];
      let captchaBlocked = false;
      for (const rule of ruleList) {
        try {
          const trace = await engine.search(rule, keyword);
          results.push(
            ...trace.items.map((item) => ({
              name: `[${rule.name}] ${item.name}`,
              src: item.src,
            })),
          );
        } catch (error) {
          if (error instanceof KazumiError) {
            if (error.code === "CAPTCHA") {
              captchaBlocked = true;
              continue;
            }
            if (error.code === "NO_RESULT") {
              continue;
            }
          }
          throw error;
        }
      }
      // 全部规则都被验证码挡住 → 明确报 CAPTCHA,而不是空结果
      if (results.length === 0 && captchaBlocked) {
        throw new KazumiError("CAPTCHA", "搜索被验证码拦截(全部规则均需验证码)");
      }
      return results;
    },

    async getRoads(item: SearchItem): Promise<Road[]> {
      const rule = inferRule(item, loader);
      const trace = await engine.queryChapters(rule, item.src);
      return trace.roads;
    },

    async getEpisodes(item: SearchItem, road: Road): Promise<Episode[]> {
      const rule = inferRule(item, loader);
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
      const rule = loader.load(opts.rule);
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
      const rule = loader.load(ruleName);
      return engine.search(rule, keyword);
    },

    async traceChapters(ruleName: string, source: string): Promise<ChapterTrace> {
      const rule = loader.load(ruleName);
      return engine.queryChapters(rule, source);
    },
  };
}

/** 从搜索结果推断所属规则(名称 [规则名] 前缀优先,否则按 baseUrl 匹配)。 */
function inferRule(item: SearchItem, loader: RuleLoader): AnimeRule {
  const match = item.name.match(/^\[([^\]]+)\]/);
  if (match?.[1]) {
    try {
      return loader.load(match[1]);
    } catch {
      // 前缀规则不存在时走 URL 匹配
    }
  }
  for (const name of loader.list()) {
    const rule = loader.load(name);
    if (item.src.startsWith(rule.baseUrl)) {
      return rule;
    }
  }
  throw new KazumiError("RULE_NOT_FOUND", `无法确定结果 ${item.name} 所属规则`);
}
