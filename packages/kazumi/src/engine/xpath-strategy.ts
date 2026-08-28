import { load as loadHtml } from "cheerio";
import { DOMParser } from "@xmldom/xmldom";
import * as xpath from "xpath";
import { KazumiError } from "../errors.js";
import type { AnimeRule, Road, SearchItem } from "../types.js";

/** 把 HTML 解析为 XML DOM 文档(cheerio 容错解析 → XML 序列化 → xmldom)。 */
export function htmlToDocument(raw: string): Document {
  const $ = loadHtml(raw);
  const xml = $.xml();
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xml, "text/xml");
  return doc as unknown as Document;
}

/**
 * 在 context 节点上执行规则 XPath。
 * Kazumi 的 Dart 库在节点上执行时 `//x` 等价 `.//x`(从该节点后代搜索),
 * `/self::*` 等价 `./self::*`(指节点自身);标准 XPath 中两者从文档根算。
 * 为保持 Kazumi 规则语义,相对表达式的 `/` / `//` 前缀统一转为 `.` / `.//`。
 */
export function queryNodes(context: unknown, expression: string): unknown[] {
  if (!expression) return [];
  const fixed = expression.startsWith("//")
    ? `.${expression}`
    : expression.startsWith("/")
      ? `.${expression}`
      : expression;
  try {
    const result = xpath.select(fixed, context as Node);
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

/** 取节点文本(trim)。 */
export function nodeText(node: unknown): string {
  try {
    const text = xpath.select1("string(.)", node as Node);
    return typeof text === "string" ? text.trim() : "";
  } catch {
    return "";
  }
}

/** 取节点指定属性值。 */
export function nodeAttr(node: unknown, name: string): string {
  try {
    const value = xpath.select1(`string(@${name})`, node as Node);
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

/**
 * 集数源站 URL 归一化(Kazumi normalizeEpisodeUrl 移植):
 * 相对路径基于 baseUrl 补全为绝对 URL;同站 URL 协议统一到 baseUrl 声明的协议;
 * 去除 path 多余尾斜杠与空 query。幂等。
 */
export function normalizeEpisodeUrl(baseUrl: string, raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  const rawUri = tryParse(trimmed);
  const baseUri = tryParse(baseUrl.trim());
  const hasValidBase = baseUri !== null;

  let resolved: URL | null = null;
  if (rawUri !== null) {
    resolved = rawUri;
  } else if (hasValidBase) {
    try {
      resolved = new URL(trimmed, baseUrl.trim());
    } catch {
      resolved = null;
    }
  }
  if (resolved === null || resolved.host === "") {
    return trimmed;
  }
  // 同站协议统一
  if (
    hasValidBase &&
    isHttpScheme(baseUri.protocol) &&
    isHttpScheme(resolved.protocol) &&
    resolved.protocol !== baseUri.protocol &&
    resolved.host === baseUri.host &&
    resolved.port === baseUri.port
  ) {
    resolved = new URL(
      resolved.href.replace(/^https?:/, baseUri.protocol),
    );
  }
  // 去 path 尾斜杠(根除外)
  let path = resolved.pathname;
  while (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  resolved.pathname = path;
  // 去空 query
  if (resolved.search === "?") {
    resolved.search = "";
  }
  return resolved.toString();
}

function tryParse(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function isHttpScheme(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

/** 搜索请求准备:把 @keyword 占位符替换为编码后的关键词。 */
export function buildSearchUrl(searchURL: string, keyword: string): string {
  return searchURL.replaceAll("@keyword", encodeURIComponent(keyword));
}

/** XPath 模式搜索解析。 */
export function parseSearch(
  raw: string,
  rule: AnimeRule,
): { items: SearchItem[]; matchedFragments: string[]; diagnostics: string[] } {
  const root = htmlToDocument(raw);
  const items: SearchItem[] = [];
  const matchedFragments: string[] = [];
  const diagnostics: string[] = [];
  const nodes = queryNodes(root, rule.searchList);
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    try {
      const name = nodeText(queryNodes(node, rule.searchName)[0] ?? node);
      const sourceNode = queryNodes(node, rule.searchResult)[0];
      const source = nodeAttr(sourceNode ?? node, "href");
      if (name === "" || source === "") {
        diagnostics.push(`搜索节点 ${index} 缺少名称或来源,已跳过`);
        continue;
      }
      items.push({ name, src: normalizeEpisodeUrl(rule.baseUrl, source) });
      matchedFragments.push(fragmentOf(node));
    } catch (error) {
      diagnostics.push(`搜索节点 ${index} 解析失败: ${(error as Error).message}`);
    }
  }
  return { items, matchedFragments, diagnostics };
}

/** XPath 模式章节解析(线路 → 集数)。 */
export function parseChapters(
  raw: string,
  rule: AnimeRule,
): { roads: Road[]; diagnostics: string[] } {
  const root = htmlToDocument(raw);
  const roads: Road[] = [];
  const diagnostics: string[] = [];
  const roadNodes = queryNodes(root, rule.chapterRoads);
  for (let roadIndex = 0; roadIndex < roadNodes.length; roadIndex++) {
    const roadNode = roadNodes[roadIndex];
    try {
      const urls: string[] = [];
      const names: string[] = [];
      const episodeNodes = queryNodes(roadNode, rule.chapterResult);
      for (let episodeIndex = 0; episodeIndex < episodeNodes.length; episodeIndex++) {
        try {
          const episodeNode = episodeNodes[episodeIndex];
          const source = nodeAttr(episodeNode, "href");
          if (source === "") {
            diagnostics.push(`线路 ${roadIndex} 的剧集节点 ${episodeIndex} 缺少 URL,已跳过`);
            continue;
          }
          const name = nodeText(episodeNode).replaceAll(/\s+/g, "");
          urls.push(normalizeEpisodeUrl(rule.baseUrl, source));
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
      roads.push({
        name: `播放线路${roads.length + 1}`,
        data: urls,
        identifier: names,
      });
    } catch (error) {
      diagnostics.push(`线路节点 ${roadIndex} 解析失败: ${(error as Error).message}`);
    }
  }
  return { roads, diagnostics };
}

/** 生成节点摘要(调试用,截断到 200 字符)。 */
function fragmentOf(node: unknown): string {
  try {
    const text = nodeText(node);
    return text.length > 200 ? text.slice(0, 200) : text;
  } catch {
    return "";
  }
}

/** 反爬:检测页面是否包含验证码挑战特征。 */
export function detectsCaptcha(raw: string, rule: AnimeRule): boolean {
  const detectValue = rule.antiCrawlerConfig?.captchaDetectValue;
  if (!detectValue || detectValue === "") return false;
  return raw.includes(detectValue);
}

export { KazumiError };
