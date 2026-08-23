/**
 * 邀请域 —— 邀请 / 请求邀请 / 自己加入实例。
 */
import type { VrchatHttpTransport } from "../transport.js";
import type { Notification } from "../types.js";

/** 发送邀请选项。 */
export interface InviteOptions {
  /** 要去的世界 id。 */
  worldId: string;
  /** 要去的实例 id。 */
  instanceId: string;
  /** 邀请消息(可选)。 */
  message?: string;
}

export class InviteApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 邀请用户到指定实例。 */
  async invite(userId: string, options: InviteOptions): Promise<Notification> {
    return this.#transport.request<Notification>({
      method: "POST",
      path: `/invite/${encodeURIComponent(userId)}`,
      json: {
        worldId: options.worldId,
        instanceId: options.instanceId,
        ...(options.message !== undefined ? { message: options.message } : {}),
      },
    });
  }

  /** 请求加入某用户所在的实例。 */
  async requestInvite(userId: string, message?: string): Promise<Notification> {
    return this.#transport.request<Notification>({
      method: "POST",
      path: `/requestInvite/${encodeURIComponent(userId)}`,
      ...(message !== undefined ? { json: { message } } : {}),
    });
  }

  /** 自己加入指定实例。 */
  async joinSelf(worldId: string, instanceId: string): Promise<Notification> {
    return this.#transport.request<Notification>({
      method: "POST",
      path: `/invite/myself/to/${encodeURIComponent(worldId)}:${encodeURIComponent(instanceId)}`,
    });
  }

  /** 响应邀请(接受/拒绝)。 */
  async respond(notificationId: string, response: "yes" | "no"): Promise<Notification> {
    return this.#transport.request<Notification>({
      method: "PUT",
      path: `/notifications/${encodeURIComponent(notificationId)}/respond`,
      json: { response },
    });
  }
}
