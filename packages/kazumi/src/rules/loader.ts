import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RestrictedJsonPath } from "../engine/restricted-jsonpath.js";
import { KazumiError } from "../errors.js";
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

  constructor(dir: string) {
    this.dir = dir;
  }

  /** 列出全部已加载规则名。 */
  list(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.replace(/\.json$/, ""));
    } catch {
      return [];
    }
  }

  /** 加载单个规则,不存在抛 RULE_NOT_FOUND。 */
  load(name: string): AnimeRule {
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
}
