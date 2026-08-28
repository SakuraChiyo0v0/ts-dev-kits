import { RestrictedJsonPath } from "./restricted-jsonpath.js";
import { KazumiError } from "../errors.js";
import type {
  AnimeRule,
  ApiChapterConfig,
  ApiSearchConfig,
  Road,
  SearchItem,
} from "../types.js";

/** 渲染模板中的 {var} 变量。 */
function renderTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = variables[name];
    if (value === undefined) return match;
    return String(value);
  });
}

/** 渲染 map 值(字符串模板替换,非字符串原样保留)。 */
function renderMap(
  map: Record<string, string> | undefined,
  variables: Record<string, unknown>,
): Record<string, string> | undefined {
  if (!map) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = renderTemplate(value, variables);
  }
  return out;
}

/** 渲染 body(仅字符串模板;对象递归渲染字符串字段)。 */
function renderBody(body: unknown, variables: Record<string, unknown>): unknown {
  if (typeof body === "string") return renderTemplate(body, variables);
  if (Array.isArray(body)) return body.map((item) => renderBody(item, variables));
  if (body !== null && typeof body === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      out[key] = renderBody(value, variables);
    }
    return out;
  }
  return body;
}

/** 已准备的规则请求(与引擎请求执行层解耦)。 */
export interface PreparedRequest {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  bodyType?: "json" | "form";
  body?: unknown;
}

/** API 模式:准备搜索请求。 */
export function prepareSearchRequest(
  config: ApiSearchConfig,
  keyword: string,
): PreparedRequest {
  return prepareRequest(config.request, { keyword });
}

/** API 模式:准备章节请求。 */
export function prepareChapterRequest(
  config: ApiChapterConfig,
  source: string,
): PreparedRequest {
  return prepareRequest(config.request, { source });
}

function prepareRequest(
  request: ApiSearchConfig["request"],
  variables: Record<string, unknown>,
): PreparedRequest {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "POST") {
    throw new KazumiError("RULE_INVALID", `仅支持 GET/POST,当前为 ${method}`);
  }
  if (request.url.trim() === "") {
    throw new KazumiError("RULE_INVALID", "API 请求 URL 不能为空");
  }
  const url = renderTemplate(request.url.trim(), variables);
  try {
    const uri = new URL(url);
    if (uri.protocol !== "http:" && uri.protocol !== "https:") {
      throw new Error("invalid");
    }
    if (uri.host === "") {
      throw new Error("invalid");
    }
  } catch {
    throw new KazumiError("RULE_INVALID", `API 请求 URL 无效: ${url}`);
  }
  const hasBody = method === "POST" && (request.bodyType === "json" || request.bodyType === "form");
  const bodyType: "json" | "form" | undefined =
    hasBody && request.bodyType !== undefined
      ? (request.bodyType as "json" | "form")
      : undefined;
  return {
    method: method as "GET" | "POST",
    url,
    ...(renderMap(request.headers, variables) ? { headers: renderMap(request.headers, variables)! } : {}),
    ...(renderMap(request.query, variables) ? { query: renderMap(request.query, variables)! } : {}),
    ...(bodyType !== undefined ? { bodyType } : {}),
    ...(hasBody ? { body: renderBody(request.body, variables) } : {}),
  };
}

/** 解析 JSON 响应。 */
export function decodeResponse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new KazumiError("RULE_INVALID", `API 响应不是有效 JSON: ${(error as Error).message}`);
  }
}

/** API 模式搜索解析。 */
export function parseSearch(
  raw: string,
  config: ApiSearchConfig,
): { items: SearchItem[]; diagnostics: string[] } {
  const document = decodeResponse(raw);
  const items: SearchItem[] = [];
  const diagnostics: string[] = [];
  const list = RestrictedJsonPath.read(document, config.listPath);
  for (let index = 0; index < list.length; index++) {
    const item = list[index];
    try {
      const name = stringValue(RestrictedJsonPath.readFirst(item, config.namePath));
      const source = stringValue(RestrictedJsonPath.readFirst(item, config.sourcePath));
      if (name === "" || source === "") {
        diagnostics.push(`搜索节点 ${index} 缺少名称或来源,已跳过`);
        continue;
      }
      items.push({ name, src: source });
    } catch (error) {
      diagnostics.push(`搜索节点 ${index} 解析失败: ${(error as Error).message}`);
    }
  }
  return { items, diagnostics };
}

/** API 模式章节解析(nested / delimited)。 */
export function parseChapters(
  raw: string,
  config: ApiChapterConfig,
  baseUrl: string,
): { roads: Road[]; diagnostics: string[] } {
  if (config.format === "delimited") {
    return parseDelimitedChapters(raw, config);
  }
  return parseNestedChapters(raw, config, baseUrl);
}

function parseNestedChapters(
  raw: string,
  config: ApiChapterConfig,
  baseUrl: string,
): { roads: Road[]; diagnostics: string[] } {
  const document = decodeResponse(raw);
  const roads: Road[] = [];
  const diagnostics: string[] = [];
  const roadList = RestrictedJsonPath.read(document, config.roadsPath ?? "$.data.roads[*]");
  for (let roadIndex = 0; roadIndex < roadList.length; roadIndex++) {
    const roadNode = roadList[roadIndex];
    try {
      const urls: string[] = [];
      const names: string[] = [];
      const episodeList = RestrictedJsonPath.read(
        roadNode,
        config.episodesPath ?? "$.episodes[*]",
      );
      for (let episodeIndex = 0; episodeIndex < episodeList.length; episodeIndex++) {
        try {
          const episodeNode = episodeList[episodeIndex];
          const source = stringValue(
            RestrictedJsonPath.readFirst(episodeNode, config.episodeUrlPath ?? "$.url"),
          );
          if (source === "") {
            diagnostics.push(`线路 ${roadIndex} 的剧集节点 ${episodeIndex} 缺少 URL,已跳过`);
            continue;
          }
          const name = stringValue(
            RestrictedJsonPath.readFirst(episodeNode, config.episodeNamePath ?? "$.name"),
          );
          urls.push(normalizeApiUrl(baseUrl, source));
          names.push(name === "" ? `第${episodeIndex + 1}集` : name);
        } catch (error) {
          diagnostics.push(
            `线路 ${roadIndex} 的剧集节点 ${episodeIndex} 解析失败: ${(error as Error).message}`,
          );
        }
      }
      if (urls.length === 0) {
        diagnostics.push(`线路 ${roadIndex} 没有有效剧集,已跳过`);
        continue;
      }
      const roadName = stringValue(
        RestrictedJsonPath.readFirst(roadNode, config.roadNamePath ?? "$.name"),
      );
      roads.push({
        name: roadName === "" ? `播放线路${roads.length + 1}` : roadName,
        data: urls,
        identifier: names,
      });
    } catch (error) {
      diagnostics.push(`线路节点 ${roadIndex} 解析失败: ${(error as Error).message}`);
    }
  }
  return { roads, diagnostics };
}

function parseDelimitedChapters(
  raw: string,
  config: ApiChapterConfig,
): { roads: Road[]; diagnostics: string[] } {
  const document = decodeResponse(raw);
  const roads: Road[] = [];
  const diagnostics: string[] = [];
  const roadSeparator = config.roadSeparator ?? "$$$";
  const episodeSeparator = config.episodeSeparator ?? "#";
  const fieldSeparator = config.fieldSeparator ?? "$";

  const roadNamesRaw = RestrictedJsonPath.readFirst(document, config.roadNamesPath ?? "$.data.roads");
  const roadEpisodesRaw = RestrictedJsonPath.readFirst(document, config.roadEpisodesPath ?? "$.data.episodes");
  const roadNames = stringValue(roadNamesRaw);
  const roadEpisodes = stringValue(roadEpisodesRaw);
  if (roadNames === "" || roadEpisodes === "") {
    diagnostics.push("delimited 响应缺少线路名或线路集数串");
    return { roads, diagnostics };
  }
  const nameParts = roadNames.split(roadSeparator);
  const episodeParts = roadEpisodes.split(roadSeparator);
  for (let roadIndex = 0; roadIndex < Math.max(nameParts.length, episodeParts.length); roadIndex++) {
    const urls = (episodeParts[roadIndex] ?? "")
      .split(episodeSeparator)
      .filter((part) => part !== "");
    if (urls.length === 0) {
      diagnostics.push(`线路 ${roadIndex} 没有有效剧集,已跳过`);
      continue;
    }
    const name = nameParts[roadIndex]?.trim() ?? "";
    roads.push({
      name: name === "" ? `播放线路${roads.length + 1}` : name,
      data: urls.map((part) => part.split(fieldSeparator)[0] ?? part),
      identifier: urls.map((part) => part.split(fieldSeparator)[1] ?? ""),
    });
  }
  return { roads, diagnostics };
}

/** API 章节 URL 归一化:相对路径基于 baseUrl 补全。 */
function normalizeApiUrl(baseUrl: string, source: string): string {
  const trimmed = source.trim();
  if (trimmed === "") return "";
  try {
    const uri = new URL(trimmed);
    if (uri.host !== "") return uri.toString();
  } catch {
    // 相对路径,走下面补全
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}
