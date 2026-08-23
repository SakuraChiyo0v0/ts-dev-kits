/**
 * 视频互动 API(只读):点赞状态查询。
 *
 * 说明:点赞/取消赞、投币、一键三连等写操作因属于 B 站刷量重灾区接口(风控最严,
 * 易触发人机验证,且批量使用违反官方规则),本 SDK 不予提供。仅保留只读查询。
 *
 * 协议对照 bilibili-API-collect docs/video/action.md:
 *   - 是否点赞:     GET  /x/web-interface/archive/has/like { aid|bvid }
 */
import type { ApiSession } from "../network.js";

/** 视频互动 API(只读)。 */
export class InteractionApi {
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  /** 判断视频近期是否被点赞(该接口只能判断"近期",老点赞可能返回 false)。 */
  async isLiked(aidOrBvid: number | string): Promise<boolean> {
    const data = await this.#session.getPlain<{ liked?: number }>(
      `${this.#session.baseUrl}/x/web-interface/archive/has/like`,
      idParams(aidOrBvid),
    );
    return data.liked === 1;
  }
}

/** 生成 aid/bvid 参数:纯数字视为 avid,否则视为 bvid。 */
function idParams(aidOrBvid: number | string): Record<string, string> {
  const value = String(aidOrBvid);
  return /^\d+$/u.test(value) ? { aid: value } : { bvid: value };
}
