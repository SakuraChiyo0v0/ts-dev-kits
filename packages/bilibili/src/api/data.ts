/**
 * 个人数据 API:稍后再看(列表/添加/删除/清空)、历史记录(列表/删除单条/清空/停用开关)。
 *
 * 协议对照 bilibili-API-collect docs/historytoview/:
 *   - 稍后再看列表: GET  /x/v2/history/toview
 *   - 添加稍后再看: POST /x/v2/history/toview/add   { aid|bvid, csrf }
 *   - 删除稍后再看: POST /x/v2/history/toview/del   { aid, viewed, csrf }
 *   - 清空稍后再看: POST /x/v2/history/toview/clear { csrf }
 *   - 历史记录列表: GET  /x/web-interface/history/cursor { max?, business?, view_at?, type?, ps? }
 *   - 删除历史记录: POST /x/v2/history/delete { kid, csrf }(kid 形如 archive_{aid})
 *   - 清空历史记录: POST /x/v2/history/clear { csrf }
 *   - 停用/启用历史: POST /x/v2/history/shadow/set { switch, csrf }
 *   - 查询停用状态: GET  /x/v2/history/shadow
 */
import { BilibiliError } from "../errors.js";
import type { ApiSession } from "../network.js";

/** 稍后再看中的视频条目。 */
export interface ToViewItem {
  aid: number;
  bvid?: string;
  title: string;
  cover?: string;
  duration?: number;
  owner?: { mid: number; name: string };
  raw: unknown;
}

/** 历史记录条目。 */
export interface HistoryItem {
  title: string;
  /** 条目目标 id(kid)。 */
  kid: number;
  /** 业务类型:archive/pgc/live/article/article-list。 */
  business: string;
  /** 查看时间(秒级时间戳)。 */
  viewAt: number;
  /** 观看进度(秒)。 */
  progress?: number;
  /** 视频总时长(秒)。 */
  duration?: number;
  /** UP 主昵称。 */
  authorName?: string;
  /** UP 主 mid。 */
  authorMid?: number;
  /** 封面 URL。 */
  cover?: string;
  /** 重定向 URL(剧集/直播)。 */
  uri?: string;
  raw: unknown;
}

/** 个人数据 API。 */
export class DataApi {
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  // ---------- 稍后再看 ----------

  /** 获取稍后再看列表。 */
  async listToView(): Promise<ToViewItem[]> {
    const data = await this.#session.getPlain<{ list?: Array<Record<string, unknown>> | null }>(
      `${this.#session.baseUrl}/x/v2/history/toview`,
      {},
    );
    return (data.list ?? []).map(toToViewItem);
  }

  /** 添加视频到稍后再看(最多 100 个)。 */
  async addToView(aidOrBvid: number | string): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/x/v2/history/toview/add`, {
      ...idParams(aidOrBvid),
    });
  }

  /** 从稍后再看移除视频。viewed: 是否标记为已观看。 */
  async removeToView(
    aid: number | string,
    options: { viewed?: boolean } = {},
  ): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/x/v2/history/toview/del`, {
      aid: Number(aid),
      ...(options.viewed !== undefined ? { viewed: options.viewed ? 1 : 0 } : {}),
    });
  }

  /** 清空稍后再看。 */
  async clearToView(): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/x/v2/history/toview/clear`, {});
  }

  // ---------- 历史记录 ----------

  /**
   * 获取历史记录(游标分页)。max/business/view_at 用于翻页(取上一页返回的 cursor 值)。
   * type: all/archive/live/article。
   */
  async listHistory(options: {
    max?: number;
    business?: string;
    viewAt?: number;
    type?: string;
    ps?: number;
  } = {}): Promise<{ list: HistoryItem[]; cursor?: { max: number; viewAt: number; business: string } }> {
    const data = await this.#session.getPlain<{
      list?: Array<Record<string, unknown>> | null;
      cursor?: { max?: number; view_at?: number; business?: string };
    }>(`${this.#session.baseUrl}/x/web-interface/history/cursor`, {
      ...(options.max !== undefined ? { max: options.max } : {}),
      ...(options.business !== undefined ? { business: options.business } : {}),
      ...(options.viewAt !== undefined ? { view_at: options.viewAt } : {}),
      ...(options.type !== undefined ? { type: options.type } : {}),
      ps: options.ps ?? 20,
    });
    return {
      list: (data.list ?? []).map(toHistoryItem),
      ...(data.cursor !== undefined
        ? {
            cursor: {
              max: data.cursor.max ?? 0,
              viewAt: data.cursor.view_at ?? 0,
              business: data.cursor.business ?? "",
            },
          }
        : {}),
    };
  }

  /** 删除一条历史记录。kid 形如 "archive_{aid}"(可由 HistoryItem.kid 直接传)。 */
  async delHistory(kid: number | string): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/x/v2/history/delete`, {
      kid: String(kid),
    });
  }

  /** 清空历史记录。 */
  async clearHistory(): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/x/v2/history/clear`, {});
  }

  /** 停用/启用历史记录功能(不影响已有记录)。 */
  async setHistoryEnabled(enabled: boolean): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/x/v2/history/shadow/set`, {
      switch: enabled ? "false" : "true",
    });
  }

  /** 查询历史记录功能是否停用(true = 已停用)。 */
  async isHistoryDisabled(): Promise<boolean> {
    const data = await this.#session.getPlain<boolean>(
      `${this.#session.baseUrl}/x/v2/history/shadow`,
      {},
    );
    return data === true;
  }
}

/** 把稍后再看条目映射为 ToViewItem。 */
function toToViewItem(entry: Record<string, unknown>): ToViewItem {
  const bvid = entry.bvid !== undefined ? String(entry.bvid) : undefined;
  const owner = entry.owner as Record<string, unknown> | undefined;
  if (bvid === undefined && entry.aid === undefined) {
    throw new BilibiliError("API_ERROR", "toview entry missing aid/bvid", { cause: entry });
  }
  return {
    aid: Number(entry.aid ?? 0),
    ...(bvid !== undefined ? { bvid } : {}),
    title: String(entry.title ?? ""),
    ...(typeof entry.pic === "string" && entry.pic !== "" ? { cover: entry.pic } : {}),
    ...(entry.duration !== undefined && Number(entry.duration) > 0
      ? { duration: Number(entry.duration) }
      : {}),
    ...(owner !== undefined && owner !== null
      ? {
          owner: {
            mid: Number(owner.mid ?? 0),
            name: String(owner.name ?? ""),
          },
        }
      : {}),
    raw: entry,
  };
}

/** 把历史记录条目映射为 HistoryItem。 */
function toHistoryItem(entry: Record<string, unknown>): HistoryItem {
  const history = entry.history as Record<string, unknown> | undefined;
  const business = history?.business !== undefined ? String(history.business) : "archive";
  return {
    title: String(entry.title ?? ""),
    kid: Number(entry.kid ?? 0),
    business,
    viewAt: Number(entry.view_at ?? 0),
    ...(entry.progress !== undefined ? { progress: Number(entry.progress) } : {}),
    ...(entry.duration !== undefined ? { duration: Number(entry.duration) } : {}),
    ...(typeof entry.author_name === "string" && entry.author_name !== ""
      ? { authorName: entry.author_name }
      : {}),
    ...(entry.author_mid !== undefined ? { authorMid: Number(entry.author_mid) } : {}),
    ...(typeof entry.cover === "string" && entry.cover !== "" ? { cover: entry.cover } : {}),
    ...(typeof entry.uri === "string" && entry.uri !== "" ? { uri: entry.uri } : {}),
    raw: entry,
  };
}

/** 生成 aid/bvid 参数:纯数字视为 avid,否则视为 bvid。 */
function idParams(aidOrBvid: number | string): Record<string, string> {
  const value = String(aidOrBvid);
  return /^\d+$/u.test(value) ? { aid: value } : { bvid: value };
}
