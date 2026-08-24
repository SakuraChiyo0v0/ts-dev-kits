/**
 * @消息 —— /bbs/app/user/message(message_type=16,需登录)。
 */
import { XiaoheiheHttpTransport } from "../transport.js";
import type { XiaoheiheMessage, XiaoheiheResponse } from "../types.js";

export interface MessagesParams {
  offset?: number;
  limit?: number;
}

/** @消息查询域。 */
export class MessagesApi {
  constructor(private readonly transport: XiaoheiheHttpTransport) {}

  /** 拉取 @消息列表(参考实现 offset 恒为 0;分页需调用方自行推进)。 */
  async listAt(params: MessagesParams = {}): Promise<XiaoheiheMessage[]> {
    const { offset = 0, limit = 20 } = params;
    const body = await this.transport.request<XiaoheiheResponse<{ messages?: XiaoheiheMessage[] }>>({
      path: "/bbs/app/user/message",
      params: { message_type: 16, offset, limit, no_more: "false" },
    });
    return body.result?.messages ?? [];
  }
}
