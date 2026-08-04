import { BilibiliError } from "../errors.js";
import type { ApiSession } from "../network.js";
import type { MediaItem, Parser } from "../types.js";

/** 把视频列表条目转为 MediaItem。 */
interface VideoListEntry {
  bvid?: string;
  aid?: number;
  cid?: number;
  title?: string;
  pic?: string;
  duration?: number;
  owner?: { mid?: number; name?: string };
}

function toVideoItem(entry: VideoListEntry, type: "video"): MediaItem {
  const bvid = entry.bvid;
  if (bvid === undefined) {
    throw new BilibiliError("API_ERROR", "Video list entry missing bvid");
  }
  const item: MediaItem = {
    type,
    id: bvid,
    bvid,
    title: entry.title ?? bvid,
    raw: entry,
  };
  if (entry.aid !== undefined) {
    item.aid = entry.aid;
  }
  if (entry.cid !== undefined) {
    item.cid = entry.cid;
  }
  if (entry.pic !== undefined) {
    item.cover = entry.pic;
  }
  if (entry.duration !== undefined) {
    item.duration = entry.duration;
  }
  if (entry.owner !== undefined && entry.owner.mid !== undefined) {
    item.owner = { mid: entry.owner.mid, name: entry.owner.name ?? "" };
  }
  return item;
}

/** UP主空间解析器。 */
export class SpaceParser implements Parser {
  readonly type = "space" as const;
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  async parse(url: string): Promise<MediaItem[]> {
    const match = url.match(/space\.bilibili\.com\/(\d+)/u);
    if (!match) {
      throw new BilibiliError("INVALID_URL", "Invalid space URL");
    }
    const mid = match[1] ?? "";
    interface ArcData {
      vlist?: Array<{
        bvid: string;
        aid: number;
        title: string;
        pic: string;
        length?: string;
      }>;
    }
    const data = await this.#session.get<ArcData>(
      `${this.#session.baseUrl}/x/space/wbi/arc/search`,
      { mid, pn: 1, ps: 40, tid: 0, order: "pubdate", platform: "web" },
    );
    return (data.vlist ?? []).map((entry) => {
      const item: MediaItem = {
        type: "video",
        id: entry.bvid,
        aid: entry.aid,
        bvid: entry.bvid,
        title: entry.title,
        raw: entry,
      };
      if (entry.pic !== undefined) {
        item.cover = entry.pic;
      }
      const duration = parseDuration(entry.length);
      if (duration !== undefined) {
        item.duration = duration;
      }
      return item;
    });
  }
}

/** 收藏夹解析器。 */
export class FavlistParser implements Parser {
  readonly type = "favlist" as const;
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  async parse(url: string): Promise<MediaItem[]> {
    const match = url.match(/fid=(\d+)|ml(\d+)/u);
    if (!match) {
      throw new BilibiliError("INVALID_URL", "Invalid favlist URL");
    }
    const mediaId = match[1] ?? match[2] ?? "";
    interface FavData {
      medias?: Array<{
        id: number;
        bvid: string;
        title: string;
        cover?: string;
        duration?: number;
        upper?: { mid?: number; name?: string };
      }>;
    }
    const data = await this.#session.getPlain<FavData>(
      `${this.#session.baseUrl}/x/v3/fav/resource/list`,
      { media_id: mediaId, pn: 1, ps: 40, type: 0 },
    );
    return (data.medias ?? []).map((entry) => ({
      type: "video" as const,
      id: entry.bvid,
      bvid: entry.bvid,
      title: entry.title,
      ...(entry.cover !== undefined ? { cover: entry.cover } : {}),
      ...(entry.duration !== undefined ? { duration: entry.duration } : {}),
      ...(entry.upper !== undefined && entry.upper.mid !== undefined
        ? { owner: { mid: entry.upper.mid, name: entry.upper.name ?? "" } }
        : {}),
      raw: entry,
    }));
  }
}

/** 合集(season/series)解析器。 */
export class CollectionParser implements Parser {
  readonly type = "collection" as const;
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  async parse(url: string): Promise<MediaItem[]> {
    this.#lastUrl = url;
    const seasonMatch = url.match(/\/lists\/(\d+)\?type=season/u);
    const seriesMatch = url.match(/\/lists\/(\d+)\?type=series/u);
    const sidMatch = url.match(/sid=(\d+)/u);

    if (seasonMatch) {
      return this.#parseSeason(seasonMatch[1] ?? "");
    }
    if (seriesMatch) {
      return this.#parseSeries(seriesMatch[1] ?? "");
    }
    if (sidMatch) {
      return this.#parseSeries(sidMatch[1] ?? "");
    }
    throw new BilibiliError("INVALID_URL", "Invalid collection URL");
  }

  async #parseSeason(seasonId: string): Promise<MediaItem[]> {
    const midMatch = /space\.bilibili\.com\/(\d+)/u.exec(this.#lastUrl);
    const mid = midMatch?.[1] ?? "";
    interface SeasonData {
      archives?: Array<{
        bvid: string;
        aid: number;
        title: string;
        pic?: string;
        duration?: number;
        owner?: { mid?: number; name?: string };
      }>;
    }
    const data = await this.#session.getPlain<SeasonData>(
      `${this.#session.baseUrl}/x/polymer/web-space/seasons_archives_list`,
      { mid, season_id: seasonId, page_size: 30, page_num: 1 },
    );
    return (data.archives ?? []).map((entry) => toVideoItem(entry, "video"));
  }

  async #parseSeries(seriesId: string): Promise<MediaItem[]> {
    const midMatch = /space\.bilibili\.com\/(\d+)/u.exec(this.#lastUrl);
    const mid = midMatch?.[1] ?? "";
    interface SeriesData {
      archives?: Array<{
        bvid: string;
        aid: number;
        title: string;
        pic?: string;
        duration?: number;
      }>;
    }
    const data = await this.#session.getPlain<SeriesData>(
      `${this.#session.baseUrl}/x/series/archives`,
      { mid, series_id: seriesId, ps: 30, pn: 1 },
    );
    return (data.archives ?? []).map((entry) => toVideoItem(entry, "video"));
  }

  #lastUrl = "";
}

/** 每周必看解析器。 */
export class PopularParser implements Parser {
  readonly type = "popular" as const;
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  async parse(url: string): Promise<MediaItem[]> {
    const match = url.match(/num=(\d+)/u);
    if (!match) {
      throw new BilibiliError("INVALID_URL", "Invalid popular URL");
    }
    const number = match[1] ?? "";
    interface PopularData {
      list?: Array<{
        bvid: string;
        aid: number;
        title: string;
        pic?: string;
        duration?: number;
        owner?: { mid?: number; name?: string };
      }>;
    }
    const data = await this.#session.get<PopularData>(
      `${this.#session.baseUrl}/x/web-interface/popular/series/one`,
      { number },
    );
    return (data.list ?? []).map((entry) => toVideoItem(entry, "video"));
  }
}

/** 稍后再看解析器(需登录)。 */
export class WatchLaterParser implements Parser {
  readonly type = "watch_later" as const;
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  async parse(url: string): Promise<MediaItem[]> {
    if (!url.includes("watchlater")) {
      throw new BilibiliError("INVALID_URL", "Invalid watch later URL");
    }
    interface WatchLaterData {
      list?: Array<{
        bvid: string;
        aid: number;
        title: string;
        pic?: string;
        duration?: number;
        owner?: { mid?: number; name?: string };
      }>;
    }
    const data = await this.#session.get<WatchLaterData>(
      `${this.#session.baseUrl}/x/v2/history/toview/web`,
      { pn: 1, ps: 20, viewed: 0 },
    );
    return (data.list ?? []).map((entry) => toVideoItem(entry, "video"));
  }
}

/** 历史记录解析器(需登录)。 */
export class HistoryParser implements Parser {
  readonly type = "history" as const;
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  async parse(url: string): Promise<MediaItem[]> {
    if (!url.includes("history")) {
      throw new BilibiliError("INVALID_URL", "Invalid history URL");
    }
    interface HistoryData {
      list?: Array<{
        history?: { bvid?: string };
        aid?: number;
        title?: string;
        pic?: string;
        duration?: number;
        author_name?: string;
        author_mid?: number;
      }>;
    }
    const data = await this.#session.getPlain<HistoryData>(
      `${this.#session.baseUrl}/x/web-interface/history/search`,
      { pn: 1, business: "archive" },
    );
    return (data.list ?? [])
      .filter((entry) => entry.history?.bvid !== undefined)
      .map((entry) => ({
        type: "video" as const,
        id: entry.history?.bvid ?? "",
        bvid: entry.history?.bvid ?? "",
        ...(entry.aid !== undefined ? { aid: entry.aid } : {}),
        title: entry.title ?? "",
        ...(entry.pic !== undefined ? { cover: entry.pic } : {}),
        ...(entry.duration !== undefined ? { duration: entry.duration } : {}),
        ...(entry.author_mid !== undefined
          ? { owner: { mid: entry.author_mid, name: entry.author_name ?? "" } }
          : {}),
        raw: entry,
      }));
  }
}

/** 把 "HH:MM:SS" 或 "MM:SS" 转为秒。 */
function parseDuration(length?: string): number | undefined {
  if (length === undefined) {
    return undefined;
  }
  const parts = length.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) {
    return undefined;
  }
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  if (parts.length === 3) {
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    return h * 60 + m;
  }
  return h;
}
