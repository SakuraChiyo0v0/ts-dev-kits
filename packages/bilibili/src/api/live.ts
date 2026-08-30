/**
 * B 站直播 API（关注列表读取）。
 *
 * 协议：GET https://api.live.bilibili.com/xlive/web-ucenter/user/following
 *   params: { page, page_size, ignoreRecord:1, hit_ab:true }
 *   返回 data.list[]（关注的直播间，含 live_status/roomid/title/cover/owner 等）。
 *
 * 仅提供只读能力（关注列表/直播间信息），直播播放/弹幕等不在本 SDK 范围。
 */
import type { ApiSession } from "../network.js";

/** 关注列表中的直播间条目。 */
export interface LiveRoom {
  /** 房间号。 */
  roomid: number;
  /** 直播状态：1 直播中 / 0 未开播（可能为最近直播过）。 */
  liveStatus: number;
  /** 直播间标题。 */
  title?: string;
  /** 封面图。 */
  cover?: string;
  /** 主播昵称。 */
  upName?: string;
  /** 主播 mid。 */
  upMid?: number;
  /** 最近开播时间(unix 秒)。 */
  liveTime?: number;
}

/** 直播 API（只读）。 */
export class LiveApi {
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  /**
   * 关注直播列表（分页）。
   * @param options.page 页码，从 1 开始
   * @param options.pageSize 每页条数，默认 20
   */
  async following(options: { page?: number; pageSize?: number } = {}): Promise<{
    rooms: LiveRoom[];
    /** 直播中的数量。 */
    liveCount: number;
    /** 总页数。 */
    totalPage: number;
  }> {
    const data = await this.#session.getPlain<{
      list?: Array<Record<string, unknown>> | null;
      live_count?: number;
      totalPage?: number;
    }>(
      `${this.#session.liveBaseUrl}/xlive/web-ucenter/user/following`,
      {
        page: options.page ?? 1,
        page_size: options.pageSize ?? 20,
        ignoreRecord: 1,
        hit_ab: 1,
      },
    );
    const rooms = (data.list ?? []).map((item): LiveRoom => {
      const owner = item.owner as Record<string, unknown> | undefined;
      return {
        roomid: Number(item.roomid ?? 0),
        liveStatus: Number(item.live_status ?? 0),
        ...(typeof item.title === "string" && item.title !== "" ? { title: item.title } : {}),
        ...(typeof item.cover === "string" && item.cover !== "" ? { cover: item.cover } : {}),
        ...(owner !== undefined && typeof owner.name === "string" && owner.name !== ""
          ? { upName: owner.name }
          : {}),
        ...(owner !== undefined && owner.mid !== undefined ? { upMid: Number(owner.mid) } : {}),
        ...(item.record_live_time !== undefined ? { liveTime: Number(item.record_live_time) } : {}),
      };
    });
    return {
      rooms,
      liveCount: Number(data.live_count ?? 0),
      totalPage: Number(data.totalPage ?? 1),
    };
  }
}
