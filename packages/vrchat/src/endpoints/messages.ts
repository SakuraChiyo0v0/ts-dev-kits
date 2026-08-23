/**
 * 快捷消息域 —— 邀请消息模板(message/response/request/requestResponse)。
 */
import type { VrchatHttpTransport } from "../transport.js";

/** 快捷消息类型。 */
export type InviteMessageType = "message" | "response" | "request" | "requestResponse";

/** 单条快捷消息。 */
export interface InviteMessage {
  slug: string;
  type: InviteMessageType;
  message: string;
  updatedAt: string;
  canBeUpdated: boolean;
  [key: string]: unknown;
}

export class MessagesApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 列出某类型的快捷消息。 */
  async list(userId: string, type: InviteMessageType): Promise<InviteMessage[]> {
    return this.#transport.request<InviteMessage[]>({
      method: "GET",
      path: `/message/${encodeURIComponent(userId)}/${encodeURIComponent(type)}`,
    });
  }

  /** 获取单个槽位的快捷消息。 */
  async get(userId: string, type: InviteMessageType, slot: number): Promise<InviteMessage> {
    return this.#transport.request<InviteMessage>({
      method: "GET",
      path: `/message/${encodeURIComponent(userId)}/${encodeURIComponent(type)}/${slot}`,
    });
  }

  /** 更新某个槽位的快捷消息。 */
  async update(
    userId: string,
    type: InviteMessageType,
    slot: number,
    message: string,
  ): Promise<InviteMessage> {
    return this.#transport.request<InviteMessage>({
      method: "PUT",
      path: `/message/${encodeURIComponent(userId)}/${encodeURIComponent(type)}/${slot}`,
      json: { message },
    });
  }
}
