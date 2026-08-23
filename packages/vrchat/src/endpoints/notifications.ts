/**
 * 通知域 —— 列表查询。
 */
import type { VrchatHttpTransport } from "../transport.js";
import type { Notification, NotificationType } from "../types.js";

/** 通知列表选项。 */
export interface NotificationsOptions {
  /** 通知类型过滤:friendRequest | invite | requestInvite | message 等。 */
  type?: NotificationType;
  /** 只看我发送的通知。 */
  sent?: boolean;
  /** 是否包含已隐藏/已处理的通知,默认 false。 */
  hidden?: boolean;
  /** 每页数量,默认 20,最大 100。 */
  n?: number;
  /** 分页偏移。 */
  offset?: number;
}

export class NotificationsApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 获取通知列表。 */
  async list(options: NotificationsOptions = {}): Promise<Notification[]> {
    return this.#transport.request<Notification[]>({
      method: "GET",
      path: "/auth/user/notifications",
      params: {
        ...(options.type !== undefined ? { type: options.type } : {}),
        ...(options.sent !== undefined ? { sent: options.sent ? "true" : "false" } : {}),
        ...(options.hidden !== undefined ? { hidden: options.hidden ? "true" : "false" } : {}),
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 按 ID 获取单条通知。 */
  async getById(notificationId: string): Promise<Notification> {
    return this.#transport.request<Notification>({
      method: "GET",
      path: `/notifications/${encodeURIComponent(notificationId)}`,
    });
  }

  /** 回复通知(如回复邀请/请求的附带消息)。 */
  async reply(notificationId: string, message: string): Promise<Notification> {
    return this.#transport.request<Notification>({
      method: "POST",
      path: `/notifications/${encodeURIComponent(notificationId)}/reply`,
      json: { message },
    });
  }

  /** 接受通知(如好友请求、邀请),返回更新后的通知。 */
  async accept(notificationId: string): Promise<Notification> {
    return this.#transport.request<Notification>({
      method: "PUT",
      path: `/auth/user/notifications/${encodeURIComponent(notificationId)}/accept`,
    });
  }

  /** 隐藏/拒绝通知,返回更新后的通知。 */
  async hide(notificationId: string): Promise<Notification> {
    return this.#transport.request<Notification>({
      method: "PUT",
      path: `/auth/user/notifications/${encodeURIComponent(notificationId)}/hide`,
    });
  }

  /** 标记通知为已读。 */
  async markSeen(notificationId: string): Promise<Notification> {
    return this.#transport.request<Notification>({
      method: "PUT",
      path: `/auth/user/notifications/${encodeURIComponent(notificationId)}/see`,
    });
  }

  /** 清除所有已读通知。 */
  async clear(): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "PUT",
      path: "/auth/user/notifications/clear",
    });
  }
}
