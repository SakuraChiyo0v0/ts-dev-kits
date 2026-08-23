/**
 * 评论 API:评论列表、发表/删除评论、置顶/取消置顶评论。
 *
 * 说明:评论点赞/点踩属于刷量重灾区操作,本 SDK 不予提供(见 interaction.ts 说明)。
 *
 * 协议对照 bilibili-API-collect docs/comment/:
 *   - 评论列表:     GET  /x/v2/reply    { type, oid, sort?, nohot?, pn?, ps? }
 *   - 发表评论:     POST /x/v2/reply/add { type, oid, message, root?, parent?, plat?, csrf }
 *   - 删除评论:     POST /x/v2/reply/del { type, oid, rpid, csrf }
 *   - 置顶/取消置顶: POST /x/v2/reply/top   { type, oid, rpid, action(1|0), csrf }
 *
 * 评论区类型代码(oid 含义见注释):1 视频(avid)、11 相簿、12 专栏(cvid)、14 音频(auid)、
 * 17 动态(动态 id)、33 课程(epid)。
 */
import { BilibiliError } from "../errors.js";
import type { ApiSession } from "../network.js";

/** 评论区类型代码(常用)。 */
export enum CommentType {
  Video = 1,
  Album = 11,
  Article = 12,
  Audio = 14,
  Dynamic = 17,
  Course = 33,
}

/** 评论条目。 */
export interface ReplyItem {
  rpid: number;
  oid: number;
  type: number;
  mid: number;
  /** 评论内容。 */
  message: string;
  /** 评论时间(秒级时间戳)。 */
  ctime: number;
  /** 点赞数。 */
  like: number;
  /** 回复数。 */
  rcount: number;
  /** 是否置顶。 */
  top?: boolean;
  /** 回复的根评论 rpid(二级及以上评论)。 */
  root?: number;
  /** 回复的父评论 rpid。 */
  parent?: number;
  /** 评论者昵称。 */
  memberName?: string;
  raw: unknown;
}

/** 评论分页结果。 */
export interface ReplyPage {
  replies: ReplyItem[];
  /** 热评。 */
  hots: ReplyItem[];
  /** 根评论条数。 */
  count: number;
  /** 总评论条数(含回复)。 */
  total: number;
}

/** 评论 API。 */
export class CommentApi {
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  /**
   * 获取评论区列表。
   * sort: 0 按时间,1 按点赞数,2 按回复数。
   */
  async list(
    type: CommentType | number,
    oid: number | string,
    options: { pn?: number; ps?: number; sort?: 0 | 1 | 2; nohot?: boolean } = {},
  ): Promise<ReplyPage> {
    const data = await this.#session.getPlain<{
      page?: { count?: number; acount?: number };
      replies?: Array<Record<string, unknown>> | null;
      hots?: Array<Record<string, unknown>> | null;
    }>(`${this.#session.baseUrl}/x/v2/reply`, {
      type: Number(type),
      oid: String(oid),
      pn: options.pn ?? 1,
      ps: Math.min(options.ps ?? 20, 20),
      ...(options.sort !== undefined ? { sort: options.sort } : {}),
      ...(options.nohot !== undefined ? { nohot: options.nohot ? 1 : 0 } : {}),
    });
    return {
      replies: (data.replies ?? []).map(toReplyItem),
      hots: (data.hots ?? []).map(toReplyItem),
      count: data.page?.count ?? 0,
      total: data.page?.acount ?? 0,
    };
  }

  /**
   * 发表评论,返回新评论 rpid。
   * root/parent: 回复评论时使用(root 为根评论 rpid,parent 为被回复评论 rpid)。
   */
  async add(
    type: CommentType | number,
    oid: number | string,
    message: string,
    options: { root?: number; parent?: number; plat?: number } = {},
  ): Promise<number> {
    if (message.trim() === "") {
      throw new BilibiliError("API_ERROR", "Comment message must not be empty");
    }
    const data = await this.#session.post<{ rpid?: number }>(
      `${this.#session.baseUrl}/x/v2/reply/add`,
      {
        type: Number(type),
        oid: String(oid),
        message,
        ...(options.root !== undefined ? { root: options.root } : {}),
        ...(options.parent !== undefined ? { parent: options.parent } : {}),
        ...(options.plat !== undefined ? { plat: options.plat } : {}),
      },
    );
    const rpid = data.rpid;
    if (rpid === undefined || rpid <= 0) {
      throw new BilibiliError("API_ERROR", "reply/add response missing rpid", { cause: data });
    }
    return rpid;
  }

  /** 删除评论(只能删自己的,或自己管理的评论区下的)。 */
  async del(type: CommentType | number, oid: number | string, rpid: number | string): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/x/v2/reply/del`, {
      type: Number(type),
      oid: String(oid),
      rpid: Number(rpid),
    });
  }

  /** 置顶评论(只能置顶自己管理的评论区中的一级评论)。 */
  async pin(type: CommentType | number, oid: number | string, rpid: number | string): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/x/v2/reply/top`, {
      type: Number(type),
      oid: String(oid),
      rpid: Number(rpid),
      action: 1,
    });
  }

  /** 取消置顶评论。 */
  async unpin(type: CommentType | number, oid: number | string, rpid: number | string): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/x/v2/reply/top`, {
      type: Number(type),
      oid: String(oid),
      rpid: Number(rpid),
      action: 0,
    });
  }
}

/** 把接口返回的评论条目映射为 ReplyItem。 */
function toReplyItem(entry: Record<string, unknown>): ReplyItem {
  const member = entry.member as Record<string, unknown> | undefined;
  const content = entry.content as Record<string, unknown> | undefined;
  return {
    rpid: Number(entry.rpid ?? 0),
    oid: Number(entry.oid ?? 0),
    type: Number(entry.type ?? 0),
    mid: Number(entry.mid ?? 0),
    message: String(content?.message ?? ""),
    ctime: Number(entry.ctime ?? 0),
    like: Number(entry.like ?? 0),
    rcount: Number(entry.rcount ?? 0),
    ...(entry.top !== undefined ? { top: entry.top === 1 } : {}),
    ...(typeof entry.root === "number" ? { root: entry.root } : {}),
    ...(typeof entry.parent === "number" ? { parent: entry.parent } : {}),
    ...(member !== undefined && typeof member.uname === "string"
      ? { memberName: member.uname }
      : {}),
    raw: entry,
  };
}
