/**
 * 播放页取流解析器 —— 静态递归解析,不执行 JS。
 *
 * Kazumi 规则产出的 episode URL 通常是播放页 HTML 而非 m3u8 直链。
 * 本解析器按优先级从播放页提取视频源:
 *   1. 页面内直出的 m3u8 URL(正则)
 *   2. `<video src>` / `<source src>` 标签
 *   3. 常见播放器变量(source/url/videoUrl/m3u8 赋值)
 *   4. `<iframe src>` / `<embed src>` 内嵌播放器(递归跟踪,带深度上限)
 *
 * 覆盖:直出型 / iframe 解析站型(如 AGE 的播放页 → iframe → m3u8)。
 * 纯 JS 动态取流(如 ezdmw 的 a_src 由 AJAX 填充)无法静态提取,
 * 返回明确错误提示,不做浏览器执行。
 */
import { load as loadHtml } from "cheerio";
import { KazumiError } from "../errors.js";

const M3U8_URL_RE = /https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*/gi;
const M3U8_PATH_RE = /(?:https?:)?\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*/gi;

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
    private readonly maxDepth = 3,
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
          "该站点可能使用 JS 动态取流,请手动用浏览器获取 m3u8 直链后重试",
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
