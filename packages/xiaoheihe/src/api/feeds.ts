/**
 * 首页帖子流 —— /bbs/app/feeds。
 */
import { XiaoheiheHttpTransport } from "../transport.js";
import type { FeedLink, XiaoheiheResponse } from "../types.js";

/** Feed 查询域。 */
export class FeedsApi {
  constructor(private readonly transport: XiaoheiheHttpTransport) {}

  /** 首页帖子流。 */
  async list(): Promise<FeedLink[]> {
    const body = await this.transport.request<XiaoheiheResponse<{ links?: FeedLink[] }>>({
      path: "/bbs/app/feeds",
      params: { pull: 1 },
    });
    return body.result?.links ?? [];
  }
}
