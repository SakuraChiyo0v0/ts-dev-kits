/**
 * 好友域 —— 列表查询。
 */
import type { VrchatHttpTransport } from "../transport.js";
import type { Friend } from "../types.js";

/** 好友列表选项。 */
export interface FriendsOptions {
  /** 是否包含离线好友,默认 true。 */
  offline?: boolean;
  /** 每页数量,默认 20,最大 100。 */
  n?: number;
  /** 分页偏移。 */
  offset?: number;
}

export class FriendsApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 获取好友列表。 */
  async list(options: FriendsOptions = {}): Promise<Friend[]> {
    return this.#transport.request<Friend[]>({
      method: "GET",
      path: "/auth/user/friends",
      params: {
        ...(options.offline !== undefined ? { offline: options.offline ? "true" : "false" } : {}),
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 发送好友请求(对方会收到 friendRequest 通知)。 */
  async sendRequest(userId: string): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "POST",
      path: `/user/${encodeURIComponent(userId)}/friendRequest`,
    });
  }

  /** 删除好友(对方不再是好友)。 */
  async delete(userId: string): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "DELETE",
      path: `/auth/user/friends/${encodeURIComponent(userId)}`,
    });
  }
}
