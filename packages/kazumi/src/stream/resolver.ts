/**
 * 播放页取流解析器 —— 静态递归解析,不执行 JS。
 *
 * Kazumi 规则产出的 episode URL 通常是播放页 HTML 而非 m3u8 直链。
 * 本解析器按优先级从播放页提取视频源:
 *   1. 页面内直出的 m3u8 URL(正则)
 *   2. `<video src>` / `<source src>` 标签
 *   3. 常见播放器变量(source/url/videoUrl/m3u8 赋值)
 *   4. MacCMS 系 `player_aaaa` 加密播放页(encrypt=2: url 为多重 URL 编码,递归解码;
 *      encrypt=0 且 url 为 VodX 风格密文 token 时无法静态解出,明确报错)
 *   5. `<iframe src>` / `<embed src>` 内嵌播放器(递归跟踪,带深度上限)
 *
 * 覆盖:直出型 / MacCMS 加密型(如 7sefun 的 player_aaaa + 多重编码) / iframe 解析站型。
 * 纯 JS 动态取流(如 ezdmw 的 a_src 由 AJAX 填充)或 VodX 密文无法静态提取,
 * 返回明确错误提示,不做浏览器执行。
 */
import { load as loadHtml } from "cheerio";
import { KazumiError } from "../errors.js";

const M3U8_URL_RE = /https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*/gi;
const M3U8_PATH_RE = /(?:https?:)?\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*/gi;
const URL_ENCODED_RE = /^[A-Za-z0-9%.+/=]+$/; // 疑似纯编码串(URL 编码 / base64,容忍域名点号)

/** 解析结果。 */
export interface ResolvedSource {
  /** m3u8 URL(绝对)。 */
  url: string;
  /** 解析路径:记录经过的页面(调试用)。 */
  path: string[];
  /** 是否通过 iframe 递归取得。 */
  viaIframe: boolean;
}

/** 取流解析器。 */
export class PlaybackResolver {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly maxDepth = 4,
  ) {}

  /**
   * 解析播放页 → m3u8 直链。
   * 输入可为 m3u8 直链(直接返回)或播放页 URL(递归解析)。
   * 解析失败抛 STREAM_PARSE_FAILED。
   */
  async resolve(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<ResolvedSource> {
    const path: string[] = [];
    const result = await this.resolveRecursive(url, headers, timeoutMs, path, 0);
    if (!result) {
      throw new KazumiError(
        "STREAM_PARSE_FAILED",
        `无法从播放页解析出 m3u8 直链: ${url}。` +
          "该站点可能使用 JS 动态取流或加密播放(如 VodX 密文),请手动用浏览器获取 m3u8 直链后重试",
      );
    }
    return result;
  }

  private async resolveRecursive(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
    path: string[],
    depth: number,
  ): Promise<ResolvedSource | null> {
    if (depth > this.maxDepth) return null;
    path.push(url);

    // 已经是 m3u8 直链
    if (/\.m3u8($|\?)/i.test(url)) {
      return { url, path: [...path], viaIframe: depth > 0 };
    }

    const html = await this.fetchText(url, headers, timeoutMs);
    const direct = extractM3u8Url(html);
    if (direct) {
      return { url: toAbsolute(url, direct), path: [...path], viaIframe: depth > 0 };
    }

    // video/source 标签
    const mediaUrl = extractMediaTagUrl(html);
    if (mediaUrl) {
      const absolute = toAbsolute(url, mediaUrl);
      if (/\.m3u8($|\?)/i.test(absolute)) {
        return { url: absolute, path: [...path], viaIframe: depth > 0 };
      }
    }

    // MacCMS 系加密播放页(player_aaaa.url 为编码串 → 解码后可能是 m3u8 或另一播放页)
    const maccmsUrl = extractMaccmsEncryptedUrl(html);
    if (maccmsUrl !== null) {
      const absolute = toAbsolute(url, maccmsUrl);
      // 解码出的是 m3u8 直链
      if (/\.m3u8($|\?)/i.test(absolute)) {
        return { url: absolute, path: [...path], viaIframe: depth > 0 };
      }
      // 解码出的是另一播放页 → 递归(可能再解一层或到直链)
      const nested = await this.resolveRecursive(
        absolute,
        headers,
        timeoutMs,
        path,
        depth + 1,
      );
      if (nested) return nested;
    }

    // iframe/embed 递归
    const frameUrl = extractIframeUrl(html);
    if (frameUrl) {
      const absolute = toAbsolute(url, frameUrl);
      const nested = await this.resolveRecursive(
        absolute,
        headers,
        timeoutMs,
        path,
        depth + 1,
      );
      if (nested) return nested;
    }

    return null;
  }

  private async fetchText(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<string> {
    const response = await this.fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!response.ok) {
      throw new KazumiError("NETWORK", `请求失败 ${url} → HTTP ${response.status}`);
    }
    return response.text();
  }
}

/**
 * 提取 MacCMS 系播放页加密 url 并解码。
 * player_aaaa = {"encrypt":2,"url":"JTY4JTc0..."} —— url 是加密串
 * （常见 base64(URL编码(真实地址)) 或 多重 URL 编码，递归解码）。
 * encrypt=0 且 url 为 VodX 风格密文 token（如 "1071_0bc36ma..."，非 %/base64 编码形态）
 * 时返回 null（无法静态解出）。
 */
export function extractMaccmsEncryptedUrl(html: string): string | null {
  // 定位 player_aaaa 赋值段，再在段内取 encrypt 与 url 字段（避免嵌套对象截断）。
  const seg = extractPlayerVarSegment(html);
  if (seg === null) return null;
  const encryptMatch = seg.match(/"encrypt"\s*:\s*(\d+)/);
  const urlMatch = seg.match(/"url"\s*:\s*"([^"]+)"/);
  if (urlMatch === null || urlMatch[1] === undefined) return null;
  const encrypt = encryptMatch !== null && encryptMatch[1] !== undefined ? Number(encryptMatch[1]) : undefined;
  const rawUrl = urlMatch[1];
  if (rawUrl === "") return null;
  // 只处理纯编码串形态（URL 编码或 base64 特征），避免把普通 URL 误解码。
  if (!URL_ENCODED_RE.test(rawUrl)) return null;

  // encrypt=2: MacCMS 经典多重编码。url 可能是「base64(URL编码(真实地址))」
  // 或「多重 URL 编码」——先试 base64 一层再看是否含 %，随后递归 URL 解码。
  if (encrypt === 2) {
    return decodeNestedUrl(rawUrl, 6);
  }
  // encrypt=0 或缺失:若 url 像 base64(含 % 特征)则尝试;VodX 密文(含 _ / -)直接放弃。
  if (encrypt === 0 || encrypt === undefined) {
    if (/[^A-Za-z0-9+/=]/.test(rawUrl)) return null;
    if (rawUrl.length < 20) return null;
    try {
      const b64 = Buffer.from(rawUrl, "base64").toString("utf8");
      if (b64.includes("%")) return decodeNestedUrl(b64, 6);
    } catch {
      // 忽略解码失败。
    }
  }
  return null;
}

/** 提取 `var player_aaaa = {...};` 的赋值段（到第一个顶层分号，容忍嵌套对象）。 */
function extractPlayerVarSegment(html: string): string | null {
  const start = html.indexOf("player_aaaa=");
  if (start < 0) return null;
  const body = html.slice(start + "player_aaaa=".length);
  // 从左括号开始计数，遇到匹配的右括号即结束（忽略分号）。
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return body.slice(0, i + 1);
    }
  }
  return null;
}

/** 递归解码：先试 base64 一层（MacCMS 常见 base64(URL编码(x)) 形态），再递归 URL 解码。 */
function decodeNestedUrl(input: string, maxLayers: number): string | null {
  let current = input;
  // 尝试 base64 解码 → 得到 %xx 串（URL 编码）再 URL 解码。
  if (URL_ENCODED_RE.test(current) && current.length > 20) {
    try {
      const b64 = Buffer.from(current, "base64").toString("utf8");
      if (b64.includes("%")) {
        let b = b64;
        for (let i = 0; i < maxLayers; i++) {
          const next = decodeURIComponent(b);
          if (next === b) break;
          b = next;
        }
        current = b;
      }
    } catch {
      // base64 失败则按纯 URL 编码处理。
    }
  }
  // 纯 URL 编码递归解码。
  for (let i = 0; i < maxLayers; i++) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}

/** 从 HTML 中提取 m3u8 URL(第一个匹配)。 */
export function extractM3u8Url(html: string): string | null {
  const matches = html.match(M3U8_PATH_RE);
  if (!matches || matches.length === 0) return null;
  // 优先 https,过滤明显噪声
  for (const match of matches) {
    if (match.startsWith("https://") || match.startsWith("http://")) {
      return match;
    }
  }
  return matches[0] ?? null;
}

/** 从 HTML 中提取 <video>/<source> 标签的 src。 */
export function extractMediaTagUrl(html: string): string | null {
  const $ = loadHtml(html);
  const sources: string[] = [];
  $("video[src], source[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src && src !== "") sources.push(src);
  });
  // video src 优先,其次 source
  const videoSrc = $("video").attr("src");
  if (videoSrc && videoSrc !== "") return videoSrc;
  return sources[0] ?? null;
}

/** 从 HTML 中提取 iframe/embed 的 src。 */
export function extractIframeUrl(html: string): string | null {
  const $ = loadHtml(html);
  const iframeSrc = $("iframe").attr("src") ?? $("embed").attr("src");
  if (iframeSrc && iframeSrc !== "" && iframeSrc !== "about:blank") {
    return iframeSrc;
  }
  return null;
}

/** 相对 URL 基于 base 解析为绝对 URL。 */
function toAbsolute(base: string, raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return trimmed;
  }
}
