/**
 * 关注关系 API:关注/取关/批量关注、关注列表/粉丝列表、关系统计、拉黑/解除拉黑、黑名单等。
 *
 * 协议对照 bilibili-API-collect docs/user/relation.md:
 *   - 操作用户关系:   POST /x/relation/modify        { fid, act, re_src?, csrf }
 *   - 批量操作用户:   POST /x/relation/batch/modify  { fids, act(1|5), re_src?, csrf } → { failed_fids }
 *   - 关注明细:       GET  /x/relation/followings    { vmid, order_type?, pn, ps }
 *   - 粉丝明细:       GET  /x/relation/followers     { vmid, pn, ps }
 *   - 关系统计:       GET  /x/relation/stat          { vmid } → { following, whisper, black, follower }
 *   - 与用户关系:     GET  /x/relation               { fid }(WBI)→ { relation, be_relation }
 *   - 批量关系:       GET  /x/relation/relations     { fids } → { mid: relation }
 *   - 黑名单:         GET  /x/relation/blacks        { pn, ps }
 *   - 互相关注:       GET  /x/relation/friends
 *   - 共同关注:       GET  /x/relation/same/followings { vmid, pn, ps }
 *   - 搜索关注:       GET  /x/relation/followings/search { vmid, name, pn, ps }
 *   - 粉丝未读数:     GET  /x/relation/followers/unread/count
 *
 * act 代码:1 关注,2 取关,4 取消悄悄关注,5 拉黑,6 取消拉黑,7 踢出粉丝。
 */
import type { ApiSession } from "../network.js";

/** 关系操作代码。 */
export type RelationAct =
  | 1   // 关注
  | 2   // 取关
  | 4   // 取消悄悄关注(已下线)
  | 5   // 拉黑
  | 6   // 取消拉黑
  | 7;  // 踢出粉丝

/** 对方对当前用户的关系属性。 */
export enum RelationAttribute {
  None = 0,
  Followed = 2,
  Mutual = 6,
  Blacklisted = 128,
}

/** 关系列表中的用户条目。 */
export interface RelationUser {
  mid: number;
  /** 对方对当前用户的关系属性(0/2/6/128)。 */
  attribute: number;
  /** 关注对方的时间(秒级时间戳)。 */
  mtime?: number;
  /** 对方所在的分组 id(默认分组为 null)。 */
  tag?: number[] | null;
  /** 是否特别关注。 */
  special?: number;
  uname: string;
  face?: string;
  sign?: string;
  /** 认证信息。 */
  officialVerify?: { type: number; desc: string };
  /** 会员信息。 */
  vip?: { vipType?: number; vipStatus?: number };
  raw: unknown;
}

/** 分页关系列表。 */
export interface RelationPage {
  list: RelationUser[];
  total: number;
}

/** 关系统计。 */
export interface RelationStat {
  /** 关注数。 */
  following: number;
  /** 悄悄关注数。 */
  whisper: number;
  /** 拉黑数。 */
  black: number;
  /** 粉丝数。 */
  follower: number;
}

/** 当前用户与目标用户的关系属性(查询关系接口)。 */
export interface RelationPair {
  /** 当前用户对目标用户的关系(attribute: 2=已关注对方, 6=互相关注, 128=已拉黑)。 */
  relation: RelationUser;
  /** 目标用户对当前用户的关系。 */
  beRelation: RelationUser;
}

/** 关注关系 API。 */
export class RelationApi {
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  // ---------- 操作 ----------

  /** 关注用户。reSrc 为关注来源代码(默认 11 个人空间)。 */
  async follow(mid: number | string, reSrc = 11): Promise<void> {
    await this.#modify(mid, 1, reSrc);
  }

  /** 取消关注用户。 */
  async unfollow(mid: number | string): Promise<void> {
    await this.#modify(mid, 2);
  }

  /** 拉黑用户。 */
  async block(mid: number | string): Promise<void> {
    await this.#modify(mid, 5);
  }

  /** 取消拉黑用户。 */
  async unblock(mid: number | string): Promise<void> {
    await this.#modify(mid, 6);
  }

  /** 把用户踢出粉丝列表。 */
  async kickFollower(mid: number | string): Promise<void> {
    await this.#modify(mid, 7);
  }

  /** 批量关注(最多 50 个,不能包含自己)。返回失败(未能关注)的 mid 列表。 */
  async batchFollow(mids: Array<number | string>, reSrc = 11): Promise<number[]> {
    return this.#batchModify(mids, 1, reSrc);
  }

  /** 批量拉黑(最多 50 个)。返回失败(未能拉黑)的 mid 列表。 */
  async batchBlock(mids: Array<number | string>): Promise<number[]> {
    return this.#batchModify(mids, 5);
  }

  // ---------- 查询 ----------

  /**
   * 获取用户关注明细。登录可看自己全部;未登录/他人仅前 100 个。
   * orderType: 留空按关注顺序, "attention" 按最常访问(仅自己有效)。
   */
  async listFollowings(
    vmid: number | string,
    options: { pn?: number; ps?: number; orderType?: string } = {},
  ): Promise<RelationPage> {
    return this.#list("/x/relation/followings", vmid, options);
  }

  /** 获取用户粉丝明细(他人可能因隐私设置不可见)。 */
  async listFollowers(
    vmid: number | string,
    options: { pn?: number; ps?: number } = {},
  ): Promise<RelationPage> {
    return this.#list("/x/relation/followers", vmid, options);
  }

  /** 获取关系统计(关注/粉丝/拉黑数)。 */
  async getStat(vmid: number | string): Promise<RelationStat> {
    const data = await this.#session.getPlain<RelationStat>(
      `${this.#session.baseUrl}/x/relation/stat`,
      { vmid: String(vmid) },
    );
    return data;
  }

  /** 查询当前用户与目标用户的互相关系(需要登录,WBI 签名)。relation:目标→自己;beRelation:自己→目标。 */
  async getRelation(mid: number | string): Promise<RelationPair> {
    const data = await this.#session.get<{
      relation?: Record<string, unknown>;
      be_relation?: Record<string, unknown>;
    }>(`${this.#session.baseUrl}/x/space/wbi/acc/relation`, { mid: String(mid) });
    const relation = data.relation ?? {};
    const beRelation = data.be_relation ?? {};
    return {
      relation: toRelationUser(relation),
      beRelation: toRelationUser(beRelation),
    };
  }

  /** 批量查询当前用户与多个用户的关系。返回 Map<mid, RelationUser>。 */
  async getRelations(mids: Array<number | string>): Promise<Map<number, RelationUser>> {
    const data = await this.#session.getPlain<Record<string, Record<string, unknown>>>(
      `${this.#session.baseUrl}/x/relation/relations`,
      { fids: mids.map(String).join(",") },
    );
    const result = new Map<number, RelationUser>();
    for (const [key, value] of Object.entries(data)) {
      const mid = Number(key);
      if (Number.isFinite(mid)) {
        result.set(mid, toRelationUser(value));
      }
    }
    return result;
  }

  /** 获取黑名单(分页)。 */
  async listBlacks(options: { pn?: number; ps?: number } = {}): Promise<RelationPage> {
    const data = await this.#session.getPlain<{
      list?: Array<Record<string, unknown>> | null;
      total?: number;
    }>(`${this.#session.baseUrl}/x/relation/blacks`, {
      pn: options.pn ?? 1,
      ps: Math.min(options.ps ?? 50, 50),
    });
    return {
      list: (data.list ?? []).map(toRelationUser),
      total: data.total ?? 0,
    };
  }

  /** 获取互相关注的用户。 */
  async listFriends(): Promise<RelationUser[]> {
    const data = await this.#session.getPlain<{ list?: Array<Record<string, unknown>> | null }>(
      `${this.#session.baseUrl}/x/relation/friends`,
      {},
    );
    return (data.list ?? []).map(toRelationUser);
  }

  /** 获取当前用户与指定用户的共同关注(分页)。 */
  async listSameFollowings(
    vmid: number | string,
    options: { pn?: number; ps?: number } = {},
  ): Promise<RelationPage> {
    return this.#list("/x/relation/same/followings", vmid, options);
  }

  /** 在当前用户关注列表中搜索用户(按昵称关键词)。 */
  async searchFollowings(
    vmid: number | string,
    name: string,
    options: { pn?: number; ps?: number } = {},
  ): Promise<RelationPage> {
    const data = await this.#session.getPlain<{
      list?: Array<Record<string, unknown>> | null;
      total?: number;
    }>(`${this.#session.baseUrl}/x/relation/followings/search`, {
      vmid: String(vmid),
      name,
      pn: options.pn ?? 1,
      ps: options.ps ?? 50,
    });
    return {
      list: (data.list ?? []).map(toRelationUser),
      total: data.total ?? 0,
    };
  }

  /** 获取粉丝列表未读状态(调用后重置未读)。 */
  async getFollowersUnread(): Promise<{ count: number; time: number }> {
    const data = await this.#session.getPlain<{ count?: number; time?: number }>(
      `${this.#session.baseUrl}/x/relation/followers/unread/count`,
      {},
    );
    return { count: data.count ?? 0, time: data.time ?? 0 };
  }

  // ---------- 私有 ----------

  /** 操作用户关系。 */
  #modify(mid: number | string, act: RelationAct, reSrc?: number): Promise<void> {
    return this.#session.post(`${this.#session.baseUrl}/x/relation/modify`, {
      fid: Number(mid),
      act,
      ...(reSrc !== undefined ? { re_src: reSrc } : {}),
    });
  }

  /** 批量操作用户关系,返回失败的 mid 列表。 */
  async #batchModify(
    mids: Array<number | string>,
    act: 1 | 5,
    reSrc?: number,
  ): Promise<number[]> {
    if (mids.length === 0) {
      return [];
    }
    const data = await this.#session.post<{ failed_fids?: number[] }>(
      `${this.#session.baseUrl}/x/relation/batch/modify`,
      {
        fids: mids.map(String).join(","),
        act,
        ...(reSrc !== undefined ? { re_src: reSrc } : {}),
      },
    );
    return data.failed_fids ?? [];
  }

  /** 通用分页列表查询。 */
  #list(
    path: string,
    vmid: number | string,
    options: { pn?: number; ps?: number; orderType?: string },
  ): Promise<RelationPage> {
    return this.#session.getPlain<{
      list?: Array<Record<string, unknown>> | null;
      total?: number;
    }>(`${this.#session.baseUrl}${path}`, {
      vmid: String(vmid),
      pn: options.pn ?? 1,
      ps: options.ps ?? 50,
      ...(options.orderType !== undefined && options.orderType !== ""
        ? { order_type: options.orderType }
        : {}),
    }).then((data) => ({
      list: (data.list ?? []).map(toRelationUser),
      total: data.total ?? 0,
    }));
  }
}

/** 把接口返回的关系条目映射为 RelationUser。 */
function toRelationUser(entry: Record<string, unknown>): RelationUser {
  const officialVerify = entry.official_verify as Record<string, unknown> | undefined;
  const vip = entry.vip as Record<string, unknown> | undefined;
  const tag = entry.tag;
  return {
    mid: Number(entry.mid ?? 0),
    attribute: Number(entry.attribute ?? 0),
    ...(entry.mtime !== undefined && Number(entry.mtime) > 0
      ? { mtime: Number(entry.mtime) }
      : {}),
    ...(Array.isArray(tag) ? { tag: tag.map(Number) } : {}),
    ...(entry.special !== undefined ? { special: Number(entry.special) } : {}),
    uname: String(entry.uname ?? ""),
    ...(typeof entry.face === "string" && entry.face !== "" ? { face: entry.face } : {}),
    ...(typeof entry.sign === "string" && entry.sign !== "" ? { sign: entry.sign } : {}),
    ...(officialVerify !== undefined && officialVerify.type !== undefined
      ? { officialVerify: { type: Number(officialVerify.type), desc: String(officialVerify.desc ?? "") } }
      : {}),
    ...(vip !== undefined
      ? {
          vip: {
            ...(vip.vipType !== undefined ? { vipType: Number(vip.vipType) } : {}),
            ...(vip.vipStatus !== undefined ? { vipStatus: Number(vip.vipStatus) } : {}),
          },
        }
      : {}),
    raw: entry,
  };
}
