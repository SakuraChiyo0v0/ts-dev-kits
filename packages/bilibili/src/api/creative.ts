/**
 * 创作中心与追番 API:稿件列表(含统计)、稿件分P信息、追番/追剧/取消追。
 *
 * 协议对照 bilibili-API-collect docs/:
 *   - 稿件列表:     GET {memberBaseUrl}/x2/creative/web/archives/sp { pn, ps }
 *   - 稿件分P信息:  GET {memberBaseUrl}/x/web/archive/videos   { aid }
 *   - 追番/追剧:    POST /pgc/web/follow/add|del { season_id, csrf }
 *
 * memberBaseUrl 默认 https://member.bilibili.com(测试可覆盖)。
 */
import { BilibiliError } from "../errors.js";
import type { ApiSession } from "../network.js";

/** 创作中心稿件条目(含播放/弹幕/评论等统计)。 */
export interface CreativeArchive {
  aid: number;
  bvid: string;
  title: string;
  cover?: string;
  desc?: string;
  /** 稿件状态。 */
  state?: number;
  /** 投稿时间(秒级时间戳)。 */
  ctime?: number;
  /** 播放量。 */
  view?: number;
  /** 弹幕数。 */
  danmaku?: number;
  /** 评论数。 */
  reply?: number;
  /** 收藏数。 */
  favorite?: number;
  /** 投币数。 */
  coin?: number;
  /** 分享数。 */
  share?: number;
  /** 点赞数。 */
  like?: number;
  raw: unknown;
}

/** 稿件分P信息。 */
export interface ArchiveVideoPage {
  cid: number;
  index: number;
  title: string;
  duration: number;
  raw: unknown;
}

/** 追番/追剧条目。 */
export interface FollowedSeason {
  seasonId: number;
  mediaId?: number;
  title: string;
  cover?: string;
  url?: string;
  /** 最新集数（如 "12"、"全 12 话"）。 */
  newEp?: string;
  total?: number;
  seasonType?: number;
  seasonTypeName?: string;
  raw: unknown;
}

/** 创作中心与追番 API。 */
export class CreativeApi {
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  /** 创作中心稿件列表(分页)。返回稿件 + 分页信息。 */
  async listArchives(options: { pn?: number; ps?: number } = {}): Promise<{
    list: CreativeArchive[];
    total: number;
  }> {
    const data = await this.#session.getPlain<{
      arc_audits?: Array<Record<string, unknown>> | null;
      page?: { total?: number; size?: number; num?: number };
    }>(
      `${this.#session.memberBaseUrl}/x2/creative/web/archives/sp`,
      {
        pn: options.pn ?? 1,
        ps: options.ps ?? 10,
      },
    );
    const list = (data.arc_audits ?? [])
      .map((entry) => {
        const archive = entry.Archive as Record<string, unknown> | undefined;
        const stat = entry.stat as Record<string, unknown> | undefined;
        if (archive === undefined || archive === null || archive.aid === undefined) {
          return undefined;
        }
        return toCreativeArchive(archive, stat);
      })
      .filter((item): item is CreativeArchive => item !== undefined);
    return {
      list,
      total: data.page?.total ?? 0,
    };
  }

  /** 获取稿件分P信息。 */
  async getArchiveVideos(aid: number | string): Promise<ArchiveVideoPage[]> {
    const data = await this.#session.getPlain<{ videos?: Array<Record<string, unknown>> | null }>(
      `${this.#session.memberBaseUrl}/x/web/archive/videos`,
      { aid: String(aid) },
    );
    return (data.videos ?? []).map((entry) => ({
      cid: Number(entry.cid ?? 0),
      index: Number(entry.index ?? 0),
      title: String(entry.title ?? ""),
      duration: Number(entry.duration ?? 0),
      raw: entry,
    }));
  }

  /** 追番/追剧(seasonId 为 ssid,番剧与影视剧通用)。 */
  async followSeason(seasonId: number | string): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/pgc/web/follow/add`, {
      season_id: String(seasonId),
    });
  }

  /** 取消追番/追剧。 */
  async unfollowSeason(seasonId: number | string): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/pgc/web/follow/del`, {
      season_id: String(seasonId),
    });
  }

  /** 追番/追剧列表(分页)。 */
  async listFollowedSeasons(
    options: { pn?: number; ps?: number } = {},
  ): Promise<{ list: FollowedSeason[]; total: number }> {
    const data = await this.#session.getPlain<{
      list?: Array<Record<string, unknown>> | null;
      total?: number;
    }>(`${this.#session.baseUrl}/pgc/web/follow/list`, {
      pn: options.pn ?? 1,
      ps: options.ps ?? 50,
    });
    return {
      list: (data.list ?? []).map(toFollowedSeason),
      total: data.total ?? 0,
    };
  }
}

/** 把追番接口条目映射为 FollowedSeason。 */
function toFollowedSeason(entry: Record<string, unknown>): FollowedSeason {
  const newEp = entry.new_ep as Record<string, unknown> | undefined;
  return {
    seasonId: Number(entry.season_id ?? 0),
    ...(entry.media_id !== undefined ? { mediaId: Number(entry.media_id) } : {}),
    title: String(entry.title ?? ""),
    ...(typeof entry.cover === "string" && entry.cover !== "" ? { cover: entry.cover } : {}),
    ...(typeof entry.url === "string" && entry.url !== "" ? { url: entry.url } : {}),
    ...(typeof newEp?.index_show === "string" && newEp.index_show !== ""
      ? { newEp: newEp.index_show }
      : {}),
    ...(entry.total !== undefined ? { total: Number(entry.total) } : {}),
    ...(entry.season_type !== undefined ? { seasonType: Number(entry.season_type) } : {}),
    ...(typeof entry.season_type_name === "string" && entry.season_type_name !== ""
      ? { seasonTypeName: entry.season_type_name }
      : {}),
    raw: entry,
  };
}

/** 把创作中心稿件条目映射为 CreativeArchive。 */
function toCreativeArchive(
  archive: Record<string, unknown>,
  stat: Record<string, unknown> | undefined,
): CreativeArchive {
  const result: CreativeArchive = {
    aid: Number(archive.aid ?? 0),
    bvid: String(archive.bvid ?? ""),
    title: String(archive.title ?? ""),
    ...(typeof archive.cover === "string" && archive.cover !== ""
      ? { cover: archive.cover }
      : {}),
    ...(typeof archive.desc === "string" && archive.desc !== ""
      ? { desc: archive.desc }
      : {}),
    ...(archive.state !== undefined ? { state: Number(archive.state) } : {}),
    ...(archive.ctime !== undefined ? { ctime: Number(archive.ctime) } : {}),
    raw: archive,
  };
  if (stat !== undefined) {
    for (const key of ["view", "danmaku", "reply", "favorite", "coin", "share", "like"] as const) {
      if (stat[key] !== undefined) {
        result[key] = Number(stat[key]);
      }
    }
  }
  return result;
}
