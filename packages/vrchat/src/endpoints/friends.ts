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

  /**
   * 获取在线好友。新版 VRChat API 已移除 presence 字段,在线状态以
   * location 是否处于世界实例(非 offline/private)判断。
   */
  async online(): Promise<Friend[]> {
    const friends = await this.list({ n: 100 });
    return friends.filter((friend) => {
      const loc = friend.location;
      return loc !== undefined && loc !== "" && loc !== "offline" && loc !== "private";
    });
  }

  /** 从好友的 location 解析世界 id(便于展示世界名)。 */
  static worldIdOf(friend: Friend): string | undefined {
    const loc = friend.location;
    if (loc === undefined || loc === "" || loc === "offline" || loc === "private") {
      return undefined;
    }
    const sep = loc.indexOf(":");
    return sep > 0 ? loc.slice(0, sep) : undefined;
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
