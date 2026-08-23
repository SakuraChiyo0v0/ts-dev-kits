/**
 * 用户信息 API(只读):通过 /x/web-interface/card 查询用户公开信息。
 *
 * 说明:仅提供只读查询;不涉及任何刷量写操作,合规且不受点赞/投币类风控影响。
 * card 接口无需 WBI 签名、无需登录即可查询公开信息。
 *
 * 协议对照 bilibili-API-collect docs/user/info.md:
 *   - 用户卡片: GET /x/web-interface/card { mid }
 */
import { BilibiliError } from "../errors.js";
import type { ApiSession } from "../network.js";

/** 用户公开信息(card 接口返回)。 */
export interface UserCard {
  mid: number;
  /** 昵称。 */
  name: string;
  /** 头像 URL。 */
  face?: string;
  /** 个人签名。 */
  sign?: string;
  /** 粉丝数。 */
  fans: number;
  /** 关注数。 */
  following: number;
  /** 等级(0-6)。 */
  level: number;
  /** 是否大会员。 */
  vip: boolean;
  /** 是否正式会员(通过答题)。 */
  official: boolean;
  /** 用户简介(空间介绍)。 */
  description?: string;
  raw: unknown;
}

/** 用户信息 API(只读)。 */
export class UserApi {
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  /** 查询用户公开信息卡片。 */
  async getCard(mid: number | string): Promise<UserCard> {
    const data = await this.#session.getPlain<{ card?: Record<string, unknown> }>(
      `${this.#session.baseUrl}/x/web-interface/card`,
      { mid: String(mid) },
    );
    if (data.card === undefined) {
      throw new BilibiliError("API_ERROR", "web-interface/card response missing card", {
        cause: data,
      });
    }
    return toUserCard(data.card);
  }

  /** 批量查询多个用户的公开信息(逐个调 card 接口,并发)。 */
  async getCards(mids: Array<number | string>): Promise<UserCard[]> {
    return Promise.all(mids.map((mid) => this.getCard(mid)));
  }
}

/** 把 card 接口返回映射为 UserCard。 */
function toUserCard(card: Record<string, unknown>): UserCard {
  const levelInfo = card.level_info as Record<string, unknown> | undefined;
  const vip = card.vip as Record<string, unknown> | undefined;
  const official = card.official_verify as Record<string, unknown> | undefined;
  return {
    mid: Number(card.mid ?? 0),
    name: String(card.name ?? ""),
    ...(typeof card.face === "string" && card.face !== "" ? { face: card.face } : {}),
    ...(typeof card.sign === "string" && card.sign !== "" ? { sign: card.sign } : {}),
    fans: Number(card.fans ?? 0),
    following: Number(card.attention ?? 0),
    level: Number(levelInfo?.current_level ?? 0),
    vip: vip !== undefined && Number(vip.status ?? 0) === 1,
    official: official !== undefined && Number(official.type ?? -1) >= 0,
    ...(typeof card.description === "string" && card.description !== ""
      ? { description: card.description }
      : {}),
    raw: card,
  };
}
