/**
 * 关注分组(Tag)API:分组列表/明细、创建/重命名/删除分组、把关注用户加入/移出分组。
 *
 * 协议对照 bilibili-API-collect docs/user/relation.md「关注分组相关」:
 *   - 分组列表:     GET  /x/relation/tags
 *   - 分组明细:     GET  /x/relation/tag      { tagid, order_type?, pn, ps }(0 默认,-10 特别关注,-20 所有)
 *   - 用户所在分组: GET  /x/relation/tag/user { fid }
 *   - 特别关注:     GET  /x/relation/tag/special
 *   - 创建分组:     POST /x/relation/tag/create  { tag, csrf } → { tagid }
 *   - 重命名分组:   POST /x/relation/tag/update  { tagid, name, csrf }
 *   - 删除分组:     POST /x/relation/tag/del     { tagid, csrf }
 *   - 修改分组成员: POST /x/relation/tags/addUsers   { fids, tagids, csrf }
 *   - 复制关注到组: POST /x/relation/tags/copyUsers  { fids, tagids, csrf }
 *   - 移动关注到组: POST /x/relation/tags/moveUsers  { beforeTagids, afterTagids, fids, csrf }
 *
 * 分组 id 特殊值:0 默认分组,-10 特别关心。addUsers 中 tagids=0 表示移回默认分组(不取关)。
 */
import { BilibiliError } from "../errors.js";
import type { ApiSession } from "../network.js";
import type { RelationUser } from "./relation.js";

/** 关注分组摘要。 */
export interface RelationTag {
  /** 分组 id(-10 特别关注,0 默认分组)。 */
  tagid: number;
  name: string;
  /** 分组成员数。 */
  count: number;
  raw: unknown;
}

/** 关注分组 API。 */
export class TagApi {
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  // ---------- 查询 ----------

  /** 获取当前用户的所有关注分组。 */
  async listTags(): Promise<RelationTag[]> {
    const data = await this.#session.getPlain<Array<Record<string, unknown>>>(
      `${this.#session.baseUrl}/x/relation/tags`,
      {},
    );
    return data.map((entry) => ({
      tagid: Number(entry.tagid ?? 0),
      name: String(entry.name ?? ""),
      count: Number(entry.count ?? 0),
      raw: entry,
    }));
  }

  /**
   * 获取分组内的用户明细(只能查自己的分组)。
   * tagid: 0 默认分组,-10 特别关注,-20 所有关注。
   */
  async listTagUsers(
    tagid: number | string,
    options: { pn?: number; ps?: number; orderType?: string } = {},
  ): Promise<RelationUser[]> {
    const data = await this.#session.getPlain<Array<Record<string, unknown>>>(
      `${this.#session.baseUrl}/x/relation/tag`,
      {
        tagid: Number(tagid),
        pn: options.pn ?? 1,
        ps: options.ps ?? 20,
        ...(options.orderType !== undefined && options.orderType !== ""
          ? { order_type: options.orderType }
          : {}),
      },
    );
    return data.map(toTagUser);
  }

  /** 查询指定用户所在的所有分组(不含默认分组)。返回 Map<tagid, name>。 */
  async getUserTags(mid: number | string): Promise<Map<number, string>> {
    const data = await this.#session.getPlain<Record<string, unknown>>(
      `${this.#session.baseUrl}/x/relation/tag/user`,
      { fid: String(mid) },
    );
    const result = new Map<number, string>();
    for (const [key, value] of Object.entries(data)) {
      const tagid = Number(key);
      if (Number.isFinite(tagid)) {
        result.set(tagid, String(value));
      }
    }
    return result;
  }

  /** 获取所有特别关注用户的 mid。 */
  async listSpecialMids(): Promise<number[]> {
    const data = await this.#session.getPlain<number[]>(
      `${this.#session.baseUrl}/x/relation/tag/special`,
      {},
    );
    return data.map(Number);
  }

  // ---------- 管理 ----------

  /** 创建分组,返回新分组 id。tag 最长 16 字符。 */
  async createTag(tag: string): Promise<number> {
    if (tag.trim() === "") {
      throw new BilibiliError("API_ERROR", "Tag name must not be empty");
    }
    const data = await this.#session.post<{ tagid?: number }>(
      `${this.#session.baseUrl}/x/relation/tag/create`,
      { tag },
    );
    const tagid = data.tagid;
    if (tagid === undefined) {
      throw new BilibiliError("API_ERROR", "relation/tag/create response missing tagid", {
        cause: data,
      });
    }
    return tagid;
  }

  /** 重命名分组。name 最长 16 字符。 */
  async renameTag(tagid: number | string, name: string): Promise<void> {
    if (name.trim() === "") {
      throw new BilibiliError("API_ERROR", "Tag name must not be empty");
    }
    await this.#session.post(`${this.#session.baseUrl}/x/relation/tag/update`, {
      tagid: Number(tagid),
      name,
    });
  }

  /** 删除分组。 */
  async deleteTag(tagid: number | string): Promise<void> {
    await this.#session.post(`${this.#session.baseUrl}/x/relation/tag/del`, {
      tagid: Number(tagid),
    });
  }

  /**
   * 把用户加入分组(可多个用户多个分组)。
   * 注意:tagids=0 表示移回默认分组(移除分组关系,不取关)。
   */
  async addUsersToTags(
    mids: Array<number | string>,
    tagids: Array<number | string>,
  ): Promise<void> {
    await this.#tagsOp("/x/relation/tags/addUsers", mids, tagids);
  }

  /** 把用户从分组中移除(移回默认分组,不取关)。 */
  async removeUsersFromTags(
    mids: Array<number | string>,
  ): Promise<void> {
    await this.#tagsOp("/x/relation/tags/addUsers", mids, [0]);
  }

  /** 复制关注用户到分组(用户保留原分组)。 */
  async copyUsersToTags(
    mids: Array<number | string>,
    tagids: Array<number | string>,
  ): Promise<void> {
    await this.#tagsOp("/x/relation/tags/copyUsers", mids, tagids);
  }

  /** 移动关注用户到分组(从原分组移除)。 */
  async moveUsersToTags(
    mids: Array<number | string>,
    beforeTagids: Array<number | string>,
    afterTagids: Array<number | string>,
  ): Promise<void> {
    if (mids.length === 0 || beforeTagids.length === 0 || afterTagids.length === 0) {
      throw new BilibiliError("API_ERROR", "mids/beforeTagids/afterTagids must not be empty");
    }
    await this.#session.post(`${this.#session.baseUrl}/x/relation/tags/moveUsers`, {
      beforeTagids: beforeTagids.map(String).join(","),
      afterTagids: afterTagids.map(String).join(","),
      fids: mids.map(String).join(","),
    });
  }

  // ---------- 私有 ----------

  async #tagsOp(
    path: string,
    mids: Array<number | string>,
    tagids: Array<number | string>,
  ): Promise<void> {
    if (mids.length === 0 || tagids.length === 0) {
      throw new BilibiliError("API_ERROR", "mids and tagids must not be empty");
    }
    await this.#session.post(`${this.#session.baseUrl}${path}`, {
      fids: mids.map(String).join(","),
      tagids: tagids.map(String).join(","),
    });
  }
}

/** 把分组内成员条目映射为 RelationUser(与 RelationApi 的字段不同,此处精简)。 */
function toTagUser(entry: Record<string, unknown>): RelationUser {
  return {
    mid: Number(entry.mid ?? 0),
    attribute: 0,
    uname: String(entry.uname ?? ""),
    ...(typeof entry.face === "string" && entry.face !== "" ? { face: entry.face } : {}),
    ...(typeof entry.sign === "string" && entry.sign !== "" ? { sign: entry.sign } : {}),
    raw: entry,
  };
}
