import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RestrictedJsonPath } from "../engine/restricted-jsonpath.js";
import { KazumiError } from "../errors.js";
import type { RuleSync } from "./sync.js";
import type { AnimeRule, ApiChapterConfig, ApiSearchConfig, RuleMode } from "../types.js";

/** 规则模式归一化(兼容 Kazumi 缺失字段默认 xpath)。 */
function normalizeMode(value: unknown): RuleMode {
  return value === "api" ? "api" : "xpath";
}

/** 从 Kazumi 兼容 JSON 构建 AnimeRule。未知字段忽略,缺失字段取默认值。 */
export function ruleFromJson(name: string, json: Record<string, unknown>): AnimeRule {
  const searchApiConfigRaw = json["searchApiConfig"];
  const chapterApiConfigRaw = json["chapterApiConfig"];
  const antiCrawlerRaw = json["antiCrawlerConfig"];

  const searchApiConfig: ApiSearchConfig | undefined =
    searchApiConfigRaw && typeof searchApiConfigRaw === "object"
      ? parseSearchApiConfig(searchApiConfigRaw as Record<string, unknown>)
      : undefined;
  const chapterApiConfig: ApiChapterConfig | undefined =
    chapterApiConfigRaw && typeof chapterApiConfigRaw === "object"
      ? parseChapterApiConfig(chapterApiConfigRaw as Record<string, unknown>)
      : undefined;

  return {
    api: str(json["api"], "1"),
    type: str(json["type"], "anime"),
    name,
    version: str(json["version"], ""),
    muliSources: bool(json["muliSources"], true),
    userAgent: str(json["userAgent"], ""),
    baseUrl: str(json["baseURL"], ""),
    searchURL: str(json["searchURL"], ""),
    referer: str(json["referer"], ""),
    searchMode: normalizeMode(json["searchMode"]),
    searchList: str(json["searchList"], ""),
    searchName: str(json["searchName"], ""),
    searchResult: str(json["searchResult"], ""),
    chapterMode: normalizeMode(json["chapterMode"]),
    chapterRoads: str(json["chapterRoads"], ""),
    chapterResult: str(json["chapterResult"], ""),
    ...(searchApiConfig ? { searchApiConfig } : {}),
    ...(chapterApiConfig ? { chapterApiConfig } : {}),
    ...(antiCrawlerRaw && typeof antiCrawlerRaw === "object"
      ? {
          antiCrawlerConfig: {
            ...(typeof (antiCrawlerRaw as Record<string, unknown>)["enabled"] === "boolean"
              ? { enabled: (antiCrawlerRaw as Record<string, unknown>)["enabled"] as boolean }
              : {}),
            ...(typeof (antiCrawlerRaw as Record<string, unknown>)["captchaDetectValue"] === "string"
              ? {
                  captchaDetectValue: (antiCrawlerRaw as Record<string, unknown>)[
                    "captchaDetectValue"
                  ] as string,
                }
              : {}),
          },
        }
      : {}),
  };
}

function parseSearchApiConfig(raw: Record<string, unknown>): ApiSearchConfig {
  const request = parseApiRequest(raw["request"]);
  return {
    request,
    listPath: str(raw["listPath"], "$.data[*]"),
    namePath: str(raw["namePath"], "$.name"),
    sourcePath: str(raw["sourcePath"], "$.url"),
  };
}

function parseChapterApiConfig(raw: Record<string, unknown>): ApiChapterConfig {
  const request = parseApiRequest(raw["request"]);
  const format = raw["format"] === "delimited" ? "delimited" : "nested";
  const cfg: Record<string, unknown> = { request, format };
  for (const key of [
    "roadsPath",
    "roadNamePath",
    "episodesPath",
    "episodeNamePath",
    "episodeUrlPath",
    "roadNamesPath",
    "roadEpisodesPath",
    "roadSeparator",
    "episodeSeparator",
    "fieldSeparator",
  ] as const) {
    const value = raw[key];
    if (typeof value === "string" && value !== "") {
      cfg[key] = value;
    }
  }
  return cfg as unknown as ApiChapterConfig;
}

function parseApiRequest(raw: unknown): ApiSearchConfig["request"] {
  if (!raw || typeof raw !== "object") {
    throw new KazumiError("RULE_INVALID", "searchApiConfig.request 缺失");
  }
  const obj = raw as Record<string, unknown>;
  const methodRaw = str(obj["method"], "GET").toUpperCase();
  if (methodRaw !== "GET" && methodRaw !== "POST") {
    throw new KazumiError("RULE_INVALID", `仅支持 GET/POST,当前为 ${methodRaw}`);
  }
  const bodyTypeRaw = str(obj["bodyType"], "none");
  const bodyType =
    bodyTypeRaw === "json" ? "json" : bodyTypeRaw === "form" ? "form" : "none";
  return {
    method: methodRaw as "GET" | "POST",
    url: str(obj["url"], ""),
    ...(typeof obj["headers"] === "object" && obj["headers"] !== null
      ? { headers: obj["headers"] as Record<string, string> }
      : {}),
    ...(typeof obj["query"] === "object" && obj["query"] !== null
      ? { query: obj["query"] as Record<string, string> }
      : {}),
    ...(bodyType !== "none" ? { bodyType } : {}),
    ...(bodyType !== "none" && "body" in obj ? { body: obj["body"] } : {}),
  };
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** 规则校验:必要字段齐全 + XPath/JSONPath 表达式合法。返回错误消息列表(空 = 合法)。 */
export function validateRule(rule: AnimeRule): string[] {
  const errors: string[] = [];
  if (!rule.name) errors.push("规则缺少 name");
  if (!rule.baseUrl) errors.push("规则缺少 baseURL");
  if (rule.searchMode === "xpath") {
    if (!rule.searchURL) errors.push("XPath 模式缺少 searchURL");
    if (!rule.searchList) errors.push("XPath 模式缺少 searchList");
    if (!rule.searchName) errors.push("XPath 模式缺少 searchName");
    if (!rule.searchResult) errors.push("XPath 模式缺少 searchResult");
    if (!rule.chapterRoads) errors.push("XPath 模式缺少 chapterRoads");
    if (!rule.chapterResult) errors.push("XPath 模式缺少 chapterResult");
  } else {
    if (!rule.searchApiConfig?.request.url) errors.push("API 模式缺少 searchApiConfig.request.url");
    for (const [label, expr] of [
      ["searchApiConfig.listPath", rule.searchApiConfig?.listPath],
      ["searchApiConfig.namePath", rule.searchApiConfig?.namePath],
      ["searchApiConfig.sourcePath", rule.searchApiConfig?.sourcePath],
    ] as const) {
      if (expr) {
        try {
          RestrictedJsonPath.validate(expr);
        } catch (error) {
          errors.push(`${label}: ${(error as Error).message}`);
        }
      }
    }
    if (rule.chapterApiConfig?.format !== "delimited") {
      for (const [label, expr] of [
        ["chapterApiConfig.roadsPath", rule.chapterApiConfig?.roadsPath],
        ["chapterApiConfig.episodesPath", rule.chapterApiConfig?.episodesPath],
        ["chapterApiConfig.episodeUrlPath", rule.chapterApiConfig?.episodeUrlPath],
      ] as const) {
        if (expr) {
          try {
            RestrictedJsonPath.validate(expr);
          } catch (error) {
            errors.push(`${label}: ${(error as Error).message}`);
          }
        }
      }
    }
  }
  return errors;
}

/** 规则目录加载器。 */
export class RuleLoader {
  private readonly dir: string;
  private readonly sync: RuleSync | undefined;

  constructor(dir: string, sync?: RuleSync) {
    this.dir = dir;
    this.sync = sync;
  }

  /** 同步是否可用。 */
  private get hasSync(): boolean {
    return this.sync !== undefined;
  }

  /** 列出全部已加载规则名(远端可用时合并远端规则)。 */
  list(): string[] {
    const local = new Set<string>();
    try {
      for (const file of readdirSync(this.dir)) {
        if (file.endsWith(".json")) {
          local.add(file.replace(/\.json$/, ""));
        }
      }
    } catch {
      // 目录不存在时仅远端
    }
    // 远端规则同步到本地缓存(只读场景下规则名以远端为准)。
    if (this.sync?.enabled) {
      const remote = this.sync.list();
      void remote; // 远端 list 是异步的,加载时同步合并见 loadRemoteNames
    }
    return [...local].sort();
  }

  /** 列出远端规则名(异步,供 client 合并)。 */
  async listRemote(): Promise<string[]> {
    if (!this.sync?.enabled) return [];
    const remote = await this.sync.list();
    // 远端规则同步到本地缓存目录(下次本地 list 也能看到)。
    for (const name of remote) {
      const json = await this.sync.get(name);
      if (json !== null) {
        this.writeLocal(name, json);
      }
    }
    return remote;
  }

  /** 加载单个规则,不存在抛 RULE_NOT_FOUND(远端可用时优先远端)。 */
  async load(name: string): Promise<AnimeRule> {
    // 远端优先:远端有则缓存到本地并返回。
    if (this.sync?.enabled) {
      const remote = await this.sync.get(name);
      if (remote !== null) {
        this.writeLocal(name, remote);
        return ruleFromJson(name, remote);
      }
    }
    return this.loadLocal(name);
  }

  /** 仅从本地加载。 */
  loadLocal(name: string): AnimeRule {
    const file = join(this.dir, `${name}.json`);
    let raw: string;
    try {
      raw = readFileSync(file, "utf-8");
    } catch {
      throw new KazumiError("RULE_NOT_FOUND", `规则不存在: ${name}`);
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      throw new KazumiError("RULE_INVALID", `规则 JSON 解析失败: ${name}`, error);
    }
    const rule = ruleFromJson(name, json);
    const errors = validateRule(rule);
    if (errors.length > 0) {
      throw new KazumiError("RULE_INVALID", `规则 ${name} 校验失败: ${errors.join("; ")}`);
    }
    return rule;
  }

  /** 写本地规则缓存(目录不存在时创建)。 */
  writeLocal(name: string, json: Record<string, unknown>): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(join(this.dir, `${name}.json`), JSON.stringify(json, null, 2), "utf-8");
    } catch (error) {
      // 本地缓存写入失败不影响远端可用,仅记录。
      throw new KazumiError(
        "RULE_INVALID",
        `规则 ${name} 本地缓存写入失败: ${(error as Error).message}`,
        error,
      );
    }
  }
}
