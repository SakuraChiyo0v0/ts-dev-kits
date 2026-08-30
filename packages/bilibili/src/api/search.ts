/**
 * B 站视频搜索 API。
 *
 * 协议对照 bilibili-API-collect docs/search/:
 *   GET /x/web-interface/wbi/search/type?search_type=video&keyword=xxx&page=1&page_size=20
 *   返回 data.result[]，每项含 bvid/title/pic/duration/play/danmaku/pubdate/author/mid。
 */
import type { ApiSession } from "../network.js";

/** 搜索结果中的视频条目。 */
export interface VideoSearchItem {
  bvid: string;
  aid: number;
  title: string;
  cover?: string;
  /** 时长(秒)。 */
  duration?: number;
  /** 播放量。 */
  play?: number;
  /** 弹幕数。 */
  danmaku?: number;
  /** 发布时间(unix 秒)。 */
  pubdate?: number;
  /** UP 主昵称。 */
  author?: string;
  /** UP 主 mid。 */
  mid?: number;
  /** 视频链接。 */
  url?: string;
}

/** 视频搜索 API。 */
export class SearchApi {
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  /** 按关键词搜索视频。page 从 1 开始，pageSize 默认 20(最大 50)。 */
  async searchVideos(
    keyword: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<VideoSearchItem[]> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    const data = await this.#session.get<{ result?: Array<Record<string, unknown>> | null }>(
      `${this.#session.baseUrl}/x/web-interface/wbi/search/type`,
      { search_type: "video", keyword, page, page_size: pageSize },
    );
    return (data.result ?? []).map(toSearchItem);
  }

  /** 综合热门视频（无需登录）。 */
  async popularVideos(
    options: { pn?: number; ps?: number } = {},
  ): Promise<VideoSearchItem[]> {
    const data = await this.#session.getPlain<{ list?: Array<Record<string, unknown>> | null }>(
      `${this.#session.baseUrl}/x/web-interface/popular`,
      { pn: options.pn ?? 1, ps: options.ps ?? 20 },
    );
    return (data.list ?? []).map(toPopularItem);
  }
}

/** "mm:ss" 时长字符串转秒。 */
function parseDuration(raw: unknown): number | undefined {
  if (typeof raw !== "string" || raw === "") return undefined;
  const m = /^(?:(\d+):)?(\d+):(\d+)$/.exec(raw);
  if (m !== null) {
    return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  }
  const m2 = /^(\d+):(\d+)$/.exec(raw);
  if (m2 !== null) return Number(m2[1]) * 60 + Number(m2[2]);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 把搜索接口原始条目映射为 VideoSearchItem。 */
function toSearchItem(entry: Record<string, unknown>): VideoSearchItem {
  const duration = parseDuration(entry.duration);
  return {
    bvid: String(entry.bvid ?? ""),
    aid: Number(entry.aid ?? 0),
    title: String(entry.title ?? "").replace(/<[^>]*>/g, ""),
    ...(typeof entry.pic === "string" && entry.pic !== "" ? { cover: entry.pic } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(entry.play !== undefined ? { play: Number(entry.play) } : {}),
    ...(entry.danmaku !== undefined ? { danmaku: Number(entry.danmaku) } : {}),
    ...(entry.pubdate !== undefined ? { pubdate: Number(entry.pubdate) } : {}),
    ...(typeof entry.author === "string" && entry.author !== ""
      ? { author: entry.author }
      : {}),
    ...(entry.mid !== undefined ? { mid: Number(entry.mid) } : {}),
    ...(typeof entry.arcurl === "string" && entry.arcurl !== ""
      ? { url: entry.arcurl }
      : {}),
  };
}

/** 把综合热门接口条目映射为 VideoSearchItem。 */
function toPopularItem(entry: Record<string, unknown>): VideoSearchItem {
  const owner = entry.owner as Record<string, unknown> | undefined;
  const stat = entry.stat as Record<string, unknown> | undefined;
  const bvid = String(entry.bvid ?? "");
  return {
    bvid,
    aid: Number(entry.aid ?? 0),
    title: String(entry.title ?? ""),
    ...(typeof entry.pic === "string" && entry.pic !== "" ? { cover: entry.pic } : {}),
    ...(entry.duration !== undefined ? { duration: Number(entry.duration) } : {}),
    ...(stat !== undefined && stat.view !== undefined ? { play: Number(stat.view) } : {}),
    ...(stat !== undefined && stat.danmaku !== undefined ? { danmaku: Number(stat.danmaku) } : {}),
    ...(entry.pubdate !== undefined ? { pubdate: Number(entry.pubdate) } : {}),
    ...(owner !== undefined && typeof owner.name === "string" && owner.name !== ""
      ? { author: owner.name }
      : {}),
    ...(owner !== undefined && owner.mid !== undefined ? { mid: Number(owner.mid) } : {}),
    ...(bvid !== "" ? { url: `https://www.bilibili.com/video/${bvid}` } : {}),
  };
}
