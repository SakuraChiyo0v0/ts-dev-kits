import { BilibiliError } from "./errors.js";

/** 解析出的链接信息。 */
export interface ParsedUrl {
  type: "video" | "bangumi" | "cheese" | "audio" | "space" | "favlist" | "collection" | "popular" | "watch_later" | "history" | "unknown";
  /** BV 号 / EP 号 / SS 号 / sid 等。 */
  id?: string;
  /** 分P 页码。 */
  page?: number;
}

const VIDEO_RE = /(?:av|AV)(\d+)|(BV[0-9A-Za-z]+)/u;
const PAGE_RE = /[?&]p=(\d+)/u;
const BANGUMI_EP_RE = /\/ep(\d+)/u;
const BANGUMI_SS_RE = /\/ss(\d+)/u;
const AUDIO_RE = /\/audio\/(?:au)?(\d+)/u;
const AUDIO_MENU_RE = /\/audio\/am(\d+)/u;
const SPACE_RE = /space\.bilibili\.com\/(\d+)/u;
const FAVLIST_RE = /favlist\?fid=(\d+)|medialist\/detail\/ml(\d+)/u;
const COLLECTION_SEASON_RE = /\/lists\/(\d+)\?type=season/u;
const COLLECTION_SERIES_RE = /\/lists\/(\d+)\?type=series/u;
const POPULAR_RE = /popular\/series\/one\?num=(\d+)/u;
const WATCH_LATER_RE = /\/list\/watchlater/u;
const HISTORY_RE = /\/account\/history/u;

/** 解析 B 站链接。 */
export function parseUrl(url: string): ParsedUrl {
  if (!url.includes("bilibili.com") && !url.includes("b23.tv")) {
    throw new BilibiliError("INVALID_URL", "Not a bilibili URL");
  }

  const watchLater = url.match(WATCH_LATER_RE);
  if (watchLater) {
    return { type: "watch_later" };
  }
  const history = url.match(HISTORY_RE);
  if (history) {
    return { type: "history" };
  }
  const collectionSeason = url.match(COLLECTION_SEASON_RE);
  if (collectionSeason) {
    return { type: "collection", id: collectionSeason[1] ?? collectionSeason[0] };
  }
  const collectionSeries = url.match(COLLECTION_SERIES_RE);
  if (collectionSeries) {
    return { type: "collection", id: collectionSeries[1] ?? collectionSeries[0] };
  }
  const popular = url.match(POPULAR_RE);
  if (popular) {
    return { type: "popular", id: popular[1] ?? popular[0] };
  }
  const bangumiEp = url.match(BANGUMI_EP_RE);
  if (bangumiEp) {
    // 区分番剧与课程(cheese)。
    if (url.includes("/cheese")) {
      return { type: "cheese", id: bangumiEp[1] ?? bangumiEp[0] };
    }
    return { type: "bangumi", id: bangumiEp[1] ?? bangumiEp[0] };
  }
  const bangumiSs = url.match(BANGUMI_SS_RE);
  if (bangumiSs) {
    return { type: "bangumi", id: bangumiSs[1] ?? bangumiSs[0] };
  }
  const audioMenu = url.match(AUDIO_MENU_RE);
  if (audioMenu) {
    return { type: "audio", id: audioMenu[1] ?? audioMenu[0] };
  }
  const audio = url.match(AUDIO_RE);
  if (audio) {
    return { type: "audio", id: audio[1] ?? audio[0] };
  }
  const space = url.match(SPACE_RE);
  if (space) {
    return { type: "space", id: space[1] ?? space[0] };
  }
  const favlist = url.match(FAVLIST_RE);
  if (favlist) {
    return { type: "favlist", id: favlist[1] ?? favlist[0] };
  }
  const video = url.match(VIDEO_RE);
  if (video) {
    const pageMatch = url.match(PAGE_RE);
    const id = video[1] ?? video[2];
    if (id === undefined) {
      throw new BilibiliError("INVALID_URL", "Invalid video URL");
    }
    return {
      type: "video",
      id,
      ...(pageMatch !== null ? { page: Number(pageMatch[1]) } : {}),
    };
  }

  return { type: "unknown" };
}
