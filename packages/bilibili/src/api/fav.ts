/**
 * 收藏夹管理 API:创建/编辑/删除收藏夹、收藏/取消收藏视频、内容复制/移动/批量删除、
 * 清空失效内容,以及收藏夹列表/元数据/内容明细查询。
 *
 * 协议对照 bilibili-API-collect docs/fav/:
 *   - 新建收藏夹:       POST /x/v3/fav/folder/add      { title, intro, privacy, cover, csrf }
 *   - 修改收藏夹:       POST /x/v3/fav/folder/edit     { media_id, title, intro, privacy, cover, csrf }
 *   - 删除收藏夹:       POST /x/v3/fav/folder/del      { media_ids(逗号分隔), csrf }
 *   - 收藏夹元数据:     GET  /x/v3/fav/folder/info     { media_id }
 *   - 用户创建的收藏夹: GET  /x/v3/fav/folder/created/list-all   { up_mid, type, rid }
 *   - 用户收藏的收藏夹: GET  /x/v3/fav/folder/collected/list    { up_mid, pn, ps }
 *   - 收藏夹内容明细:   GET  /x/v3/fav/resource/list   { media_id, pn, ps, keyword, order, tid, type }
 *   - 收藏/取消收藏:    POST /x/v3/fav/resource/deal   { rid, type=2, add_media_ids | del_media_ids, csrf }
 *   - 批量复制:         POST /x/v3/fav/resource/copy   { src_media_id, tar_media_id, mid, resources, csrf }
 *   - 批量移动:         POST /x/v3/fav/resource/move   { src_media_id, tar_media_id, mid, resources, csrf }
 *   - 批量删除:         POST /x/v3/fav/resource/batch-del { media_id, resources, csrf }
 *   - 清空失效内容:     POST /x/v3/fav/resource/clean  { media_id, csrf }
 *   - 是否已收藏:       GET  /x/v2/fav/video/favoured  { aid }
 *
 * resources 格式:{内容id}:{内容类型},逗号分隔。类型:2=视频稿件(avid)、12=音频(auid)、21=视频合集。
 * 所有写操作需要登录(bili_jct);ApiSession.post 自动注入 csrf。
 */
import { BilibiliError } from "../errors.js";
import type { ApiSession } from "../network.js";

/** 收藏夹内容类型。 */
export type FavResourceType = 2 | 12 | 21;

/** 收藏夹内容引用(用于复制/移动/批量删除)。 */
export interface FavResource {
  type: FavResourceType;
  id: number | string;
}

/** 收藏夹元数据。 */
export interface FavFolder {
  /** 完整 id(mlid = 原始 id + 创建者 mid 尾号 2 位)。 */
  id: number;
  /** 原始 id。 */
  fid: number;
  /** 创建者 mid。 */
  mid: number;
  title: string;
  /** 内容数量。 */
  mediaCount: number;
  /** 是否私有(attr bit0)。 */
  privacy: boolean;
  /** 是否为默认收藏夹(attr bit1)。 */
  isDefault: boolean;
  intro?: string;
  cover?: string;
  ctime?: number;
  mtime?: number;
  raw: unknown;
}

/** 收藏夹内容明细(视频稿件)。 */
export interface FavResourceItem {
  /** avid。 */
  id: number;
  bvid: string;
  title: string;
  cover?: string;
  duration?: number;
  upper?: { mid: number; name: string };
  raw: unknown;
}

/** 收藏夹内容分页结果。 */
export interface FavResourcePage {
  list: FavResourceItem[];
  hasMore: boolean;
  info?: FavFolder;
}

interface FavFolderDto {
  id: number;
  fid: number;
  mid: number;
  title: string;
  media_count: number;
  attr?: number;
  intro?: string;
  cover?: string;
  ctime?: number;
  mtime?: number;
}

/** 收藏夹 API。 */
export class FavApi {
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  // ---------- 收藏夹管理 ----------

  /** 新建收藏夹,返回新收藏夹 media_id。privacy: 0 公开,1 私密。 */
  async createFolder(options: {
    title: string;
    intro?: string;
    privacy?: 0 | 1;
    cover?: string;
  }): Promise<number> {
    const title = options.title.trim();
    if (title === "") {
      throw new BilibiliError("API_ERROR", "Folder title must not be empty");
    }
    const data = await this.#session.post<{ id?: number }>(
      `${this.#session.baseUrl}/x/v3/fav/folder/add`,
      {
        title,
        ...(options.intro !== undefined && options.intro !== ""
          ? { intro: options.intro }
          : {}),
        ...(options.privacy !== undefined ? { privacy: options.privacy } : {}),
        ...(options.cover !== undefined && options.cover !== ""
          ? { cover: options.cover }
          : {}),
      },
    );
    const id = data.id;
    if (id === undefined || id <= 0) {
      throw new BilibiliError("API_ERROR", "fav/folder/add response missing id", {
        cause: data,
      });
    }
    return id;
  }

  /** 修改收藏夹(标题必传,不修改的字段省略)。 */
  async editFolder(
    mediaId: number | string,
    options: { title?: string; intro?: string; privacy?: 0 | 1; cover?: string },
  ): Promise<void> {
    const title = options.title?.trim();
    if (title !== undefined && title === "") {
      throw new BilibiliError("API_ERROR", "Folder title must not be empty");
    }
    await this.#session.post(`${this.#session.baseUrl}/x/v3/fav/folder/edit`, {
      media_id: Number(mediaId),
      title: title ?? "", // 接口要求 title 必传;未提供时传原名(由调用方保证)
      ...(options.intro !== undefined ? { intro: options.intro } : {}),
      ...(options.privacy !== undefined ? { privacy: options.privacy } : {}),
      ...(options.cover !== undefined ? { cover: options.cover } : {}),
    });
  }

  /** 删除一个或多个收藏夹(media_ids 逗号分隔)。 */
  async deleteFolder(mediaIds: Array<number | string>): Promise<void> {
    if (mediaIds.length === 0) {
      throw new BilibiliError("API_ERROR", "mediaIds must not be empty");
    }
    await this.#session.post(`${this.#session.baseUrl}/x/v3/fav/folder/del`, {
      media_ids: mediaIds.map(String).join(","),
    });
  }

  // ---------- 收藏内容操作 ----------

  /** 收藏视频(aid)到指定收藏夹列表。 */
  async addVideo(
    rid: number | string,
    mediaIds: Array<number | string>,
  ): Promise<void> {
    if (mediaIds.length === 0) {
      throw new BilibiliError("API_ERROR", "mediaIds must not be empty");
    }
    await this.#deal(rid, { addMediaIds: mediaIds });
  }

  /** 取消收藏视频(aid)从指定收藏夹列表。 */
  async removeVideo(
    rid: number | string,
    mediaIds: Array<number | string>,
  ): Promise<void> {
    if (mediaIds.length === 0) {
      throw new BilibiliError("API_ERROR", "mediaIds must not be empty");
    }
    await this.#deal(rid, { delMediaIds: mediaIds });
  }

  /** 判断视频是否已被当前账号收藏。 */
  async isFavoured(aidOrBvid: number | string): Promise<boolean> {
    const aid = await this.#resolveAid(aidOrBvid);
    const data = await this.#session.getPlain<{ favoured?: boolean }>(
      `${this.#session.baseUrl}/x/v2/fav/video/favoured`,
      { aid },
    );
    return data.favoured === true;
  }

  /** 批量复制内容:把 src 收藏夹中的 resources 复制到 tar 收藏夹。 */
  async copyResources(
    srcMediaId: number | string,
    tarMediaId: number | string,
    resources: FavResource[],
  ): Promise<void> {
    await this.#copyOrMove("copy", srcMediaId, tarMediaId, resources);
  }

  /** 批量移动内容:把 src 收藏夹中的 resources 移动到 tar 收藏夹。 */
  async moveResources(
    srcMediaId: number | string,
    tarMediaId: number | string,
    resources: FavResource[],
  ): Promise<void> {
    await this.#copyOrMove("move", srcMediaId, tarMediaId, resources);
  }

  /** 从收藏夹批量删除内容。 */
  async batchRemove(
    mediaId: number | string,
    resources: FavResource[],
  ): Promise<void> {
    const encoded = encodeResources(resources);
    await this.#session.post(`${this.#session.baseUrl}/x/v3/fav/resource/batch-del`, {
      media_id: Number(mediaId),
      resources: encoded,
      platform: "web",
    });
  }

  /** 清空收藏夹中的失效内容。 */
  async cleanInvalid(mediaId: number | string): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/x/v3/fav/resource/clean`, {
      media_id: Number(mediaId),
    });
  }

  // ---------- 查询 ----------

  /** 获取收藏夹元数据。 */
  async getFolderInfo(mediaId: number | string): Promise<FavFolder> {
    const data = await this.#session.getPlain<FavFolderDto>(
      `${this.#session.baseUrl}/x/v3/fav/folder/info`,
      { media_id: String(mediaId) },
    );
    return toFavFolder(data);
  }

  /** 获取指定用户创建的所有收藏夹。type: 0 全部,2 视频稿件;rid 为视频 avid 时返回包含该视频的收藏夹。 */
  async listCreatedFolders(
    upMid: number | string,
    options: { type?: 0 | 2; rid?: number } = {},
  ): Promise<FavFolder[]> {
    const data = await this.#session.getPlain<{ list?: FavFolderDto[] | null }>(
      `${this.#session.baseUrl}/x/v3/fav/folder/created/list-all`,
      {
        up_mid: String(upMid),
        type: options.type ?? 0,
        ...(options.rid !== undefined ? { rid: options.rid } : {}),
      },
    );
    return (data.list ?? []).map(toFavFolder);
  }

  /** 获取指定用户收藏(订阅)的收藏夹列表。 */
  async listCollectedFolders(
    upMid: number | string,
    options: { pn?: number; ps?: number } = {},
  ): Promise<FavFolder[]> {
    const data = await this.#session.getPlain<{ list?: FavFolderDto[] | null }>(
      `${this.#session.baseUrl}/x/v3/fav/folder/collected/list`,
      {
        up_mid: String(upMid),
        pn: options.pn ?? 1,
        ps: options.ps ?? 20,
        platform: "web",
      },
    );
    return (data.list ?? []).map(toFavFolder);
  }

  /**
   * 获取收藏夹内容明细(分页)。
   * order: mtime(按收藏时间)/ view(按播放量)/ pubtime(按投稿时间);type: 0 当前收藏夹,1 全部。
   */
  async listResources(
    mediaId: number | string,
    options: {
      pn?: number;
      ps?: number;
      keyword?: string;
      order?: "mtime" | "view" | "pubtime";
      tid?: number;
      type?: 0 | 1;
    } = {},
  ): Promise<FavResourcePage> {
    const data = await this.#session.getPlain<{
      medias?: Array<Record<string, unknown>> | null;
      has_more?: boolean;
      info?: FavFolderDto;
    }>(`${this.#session.baseUrl}/x/v3/fav/resource/list`, {
      media_id: String(mediaId),
      pn: options.pn ?? 1,
      ps: Math.min(options.ps ?? 20, 20),
      ...(options.keyword !== undefined && options.keyword !== ""
        ? { keyword: options.keyword }
        : {}),
      ...(options.order !== undefined ? { order: options.order } : {}),
      ...(options.tid !== undefined ? { tid: options.tid } : {}),
      ...(options.type !== undefined ? { type: options.type } : {}),
      platform: "web",
    });
    const list = (data.medias ?? []).map((entry) => toFavResourceItem(entry));
    return {
      list,
      hasMore: data.has_more === true,
      ...(data.info !== undefined ? { info: toFavFolder(data.info) } : {}),
    };
  }

  // ---------- 私有 ----------

  /** 收藏/取消收藏视频(deal 接口,rid 只接受 avid,自动解析 bvid)。 */
  async #deal(
    rid: number | string,
    options: { addMediaIds?: Array<number | string>; delMediaIds?: Array<number | string> },
  ): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/x/v3/fav/resource/deal`, {
      rid: await this.#resolveAid(rid),
      type: 2,
      ...(options.addMediaIds !== undefined && options.addMediaIds.length > 0
        ? { add_media_ids: options.addMediaIds.map(String).join(",") }
        : {}),
      ...(options.delMediaIds !== undefined && options.delMediaIds.length > 0
        ? { del_media_ids: options.delMediaIds.map(String).join(",") }
        : {}),
      platform: "web",
    });
  }

  /** 把 aid 或 bvid 统一解析为 avid(纯数字直接用;bvid 走 view 接口解析)。 */
  async #resolveAid(aidOrBvid: number | string): Promise<number> {
    const raw = String(aidOrBvid);
    if (/^\d+$/u.test(raw)) {
      return Number(raw);
    }
    const data = await this.#session.getPlain<{ aid?: number }>(
      `${this.#session.baseUrl}/x/web-interface/view`,
      { bvid: raw },
    );
    if (data.aid === undefined) {
      throw new BilibiliError("API_ERROR", `cannot resolve aid from ${raw}`);
    }
    return data.aid;
  }

  /** 批量复制/移动内容。 */
  async #copyOrMove(
    op: "copy" | "move",
    srcMediaId: number | string,
    tarMediaId: number | string,
    resources: FavResource[],
  ): Promise<void> {
    if (resources.length === 0) {
      throw new BilibiliError("API_ERROR", "resources must not be empty");
    }
    const mid = this.#session.currentMid();
    if (mid === undefined) {
      throw new BilibiliError("LOGIN_REQUIRED", "Missing DedeUserID cookie; login is required");
    }
    await this.#session.post(`${this.#session.baseUrl}/x/v3/fav/resource/${op}`, {
      src_media_id: Number(srcMediaId),
      tar_media_id: Number(tarMediaId),
      mid,
      resources: encodeResources(resources),
      platform: "web",
    });
  }
}

/** 把 resources 编码为 "id:type,id:type" 形式。 */
function encodeResources(resources: FavResource[]): string {
  return resources.map((r) => `${String(r.id)}:${r.type}`).join(",");
}

/** 把接口返回的收藏夹对象映射为 FavFolder。 */
function toFavFolder(dto: FavFolderDto): FavFolder {
  const attr = dto.attr ?? 0;
  return {
    id: dto.id,
    fid: dto.fid,
    mid: dto.mid,
    title: dto.title,
    mediaCount: dto.media_count,
    privacy: (attr & 1) === 1,
    isDefault: (attr & 2) === 2,
    ...(dto.intro !== undefined && dto.intro !== "" ? { intro: dto.intro } : {}),
    ...(dto.cover !== undefined && dto.cover !== "" ? { cover: dto.cover } : {}),
    ...(dto.ctime !== undefined && dto.ctime > 0 ? { ctime: dto.ctime } : {}),
    ...(dto.mtime !== undefined && dto.mtime > 0 ? { mtime: dto.mtime } : {}),
    raw: dto,
  };
}

/** 把收藏夹内容条目映射为 FavResourceItem。 */
function toFavResourceItem(entry: Record<string, unknown>): FavResourceItem {
  const id = Number(entry.id ?? 0);
  const bvid = String(entry.bvid ?? "");
  const upper = entry.upper as Record<string, unknown> | undefined;
  const duration = entry.duration !== undefined ? Number(entry.duration) : Number.NaN;
  return {
    id,
    bvid,
    title: String(entry.title ?? ""),
    ...(typeof entry.pic === "string" && entry.pic !== "" ? { cover: entry.pic } : {}),
    ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
    ...(upper !== undefined && typeof upper.mid === "number"
      ? { upper: { mid: upper.mid, name: String(upper.name ?? "") } }
      : {}),
    raw: entry,
  };
}
