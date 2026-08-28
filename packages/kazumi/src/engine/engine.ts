import { createLogger } from "@sakurachiyo0v0/logger";
import { KazumiError } from "../errors.js";
import type { AnimeRule, Road, RuleTrace, SearchItem } from "../types.js";
import type { RuleRequestExecutor } from "../request/executor.js";
import { DefaultRuleRequestExecutor } from "../request/executor.js";
import {
  buildSearchUrl,
  detectsCaptcha,
  parseChapters as parseXpathChapters,
  parseSearch as parseXpathSearch,
} from "./xpath-strategy.js";
import {
  parseChapters as parseApiChapters,
  parseSearch as parseApiSearch,
  prepareChapterRequest,
  prepareSearchRequest,
} from "./api-strategy.js";

const logger = createLogger({ namespace: "kazumi" }).child("engine");

/** 搜索追踪(含原始响应,供 CLI rules test 调试)。 */
export interface SearchTrace extends RuleTrace {
  items: SearchItem[];
}

/** 章节追踪。 */
export interface ChapterTrace extends RuleTrace {
  roads: Road[];
}

/** 规则引擎:按规则模式(xpath/api)分派搜索与章节查询。 */
export class RuleEngine {
  private readonly executor: RuleRequestExecutor;

  constructor(executor?: RuleRequestExecutor) {
    this.executor = executor ?? new DefaultRuleRequestExecutor();
  }

  /** 搜索:按关键词执行单条规则。 */
  async search(rule: AnimeRule, keyword: string): Promise<SearchTrace> {
    try {
      const raw = await this.executeSearch(rule, keyword);
      if (detectsCaptcha(raw, rule)) {
        throw new KazumiError("CAPTCHA", `规则 ${rule.name} 需要验证码`);
      }
      if (rule.searchMode === "api" && rule.searchApiConfig) {
        const parsed = parseApiSearch(raw, rule.searchApiConfig);
        if (parsed.items.length === 0) {
          throw new KazumiError("NO_RESULT", `规则 ${rule.name} 无搜索结果`);
        }
        return {
          rawResponse: raw,
          matchedFragments: [],
          diagnostics: parsed.diagnostics,
          items: parsed.items,
        };
      }
      const parsed = parseXpathSearch(raw, rule);
      if (parsed.items.length === 0) {
        throw new KazumiError("NO_RESULT", `规则 ${rule.name} 无搜索结果`);
      }
      return {
        rawResponse: raw,
        matchedFragments: parsed.matchedFragments,
        diagnostics: parsed.diagnostics,
        items: parsed.items,
      };
    } catch (error) {
      if (error instanceof KazumiError) throw error;
      logger.warn(`规则 ${rule.name} 搜索失败`, { error: String(error) });
      throw new KazumiError("UNKNOWN", `规则 ${rule.name} 搜索失败`, error);
    }
  }

  /** 查询线路(章节):按源站详情页 URL 执行单条规则。 */
  async queryChapters(rule: AnimeRule, source: string): Promise<ChapterTrace> {
    try {
      const raw = await this.executeChapters(rule, source);
      if (rule.chapterMode === "api" && rule.chapterApiConfig) {
        const parsed = parseApiChapters(raw, rule.chapterApiConfig, rule.baseUrl);
        if (parsed.roads.length === 0) {
          throw new KazumiError("NO_RESULT", `规则 ${rule.name} 无线路`);
        }
        return {
          rawResponse: raw,
          matchedFragments: [],
          diagnostics: parsed.diagnostics,
          roads: parsed.roads,
        };
      }
      const parsed = parseXpathChapters(raw, rule);
      if (parsed.roads.length === 0) {
        throw new KazumiError("NO_RESULT", `规则 ${rule.name} 无线路`);
      }
      return {
        rawResponse: raw,
        matchedFragments: [],
        diagnostics: parsed.diagnostics,
        roads: parsed.roads,
      };
    } catch (error) {
      if (error instanceof KazumiError) throw error;
      logger.warn(`规则 ${rule.name} 章节查询失败`, { error: String(error) });
      throw new KazumiError("UNKNOWN", `规则 ${rule.name} 章节查询失败`, error);
    }
  }

  private async executeSearch(rule: AnimeRule, keyword: string): Promise<string> {
    if (rule.searchMode === "api" && rule.searchApiConfig) {
      const request = prepareSearchRequest(rule.searchApiConfig, keyword);
      return this.executor.execute(request, rule);
    }
    const url = buildSearchUrl(rule.searchURL, keyword);
    return this.executor.execute({ method: "GET", url }, rule);
  }

  private async executeChapters(rule: AnimeRule, source: string): Promise<string> {
    if (rule.chapterMode === "api" && rule.chapterApiConfig) {
      const request = prepareChapterRequest(
        rule.chapterApiConfig,
        resolveAbsolute(rule.baseUrl, source),
      );
      return this.executor.execute(request, rule);
    }
    return this.executor.execute({ method: "GET", url: source }, rule);
  }
}

/** 相对 URL 基于 baseUrl 补全为绝对 URL。 */
function resolveAbsolute(baseUrl: string, source: string): string {
  try {
    const uri = new URL(source);
    if (uri.host !== "") return source;
  } catch {
    // 相对路径,走补全
  }
  try {
    return new URL(source, baseUrl).toString();
  } catch {
    return source;
  }
}
