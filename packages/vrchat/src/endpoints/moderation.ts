/**
 * 审核域 —— 玩家管理(封禁/静音/举报)。
 */
import type { VrchatHttpTransport } from "../transport.js";

/** 玩家管理条目类型。 */
export type PlayerModerationType =
  | "mute"
  | "unmute"
  | "block"
  | "unblock"
  | "interactPermission"
  | "avatarHide";

/** 玩家管理条目。 */
export interface PlayerModeration {
  id: string;
  type: PlayerModerationType;
  targetUserId: string;
  created: string;
  [key: string]: unknown;
}

/** 创建玩家管理选项(官方 ModerateUserRequest 字段)。 */
export interface CreatePlayerModerationOptions {
  type: PlayerModerationType;
  /** 被管理的目标用户 id(官方字段名 moderated)。 */
  moderated: string;
}

/** 解除玩家管理选项。 */
export interface UnmoderateOptions {
  type: PlayerModerationType;
  /** 被解除管理的目标用户 id。 */
  moderated: string;
}

/** 举报选项。 */
export interface ReportOptions {
  reporterUserId: string;
  reportedUserId: string;
  /** 举报类型,如 "None" / "Avatar" / "Discrimination" 等。 */
  type: string;
  comment?: string;
}

export class ModerationApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 列出当前用户的玩家管理(封禁/静音)条目。 */
  async list(options: { type?: PlayerModerationType } = {}): Promise<PlayerModeration[]> {
    return this.#transport.request<PlayerModeration[]>({
      method: "GET",
      path: "/auth/user/playermoderations",
      params: options.type !== undefined ? { type: options.type } : {},
    });
  }

  /** 创建玩家管理(静音/封禁等)。 */
  async create(options: CreatePlayerModerationOptions): Promise<PlayerModeration> {
    return this.#transport.request<PlayerModeration>({
      method: "POST",
      path: "/auth/user/playermoderations",
      json: options,
    });
  }

  /** 解除玩家管理(官方 PUT /auth/user/unplayermoderate;无按 id 删除路径)。 */
  async unmoderate(options: UnmoderateOptions): Promise<PlayerModeration> {
    return this.#transport.request<PlayerModeration>({
      method: "PUT",
      path: "/auth/user/unplayermoderate",
      json: options,
    });
  }

  /** 举报用户。 */
  async report(options: ReportOptions): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "POST",
      path: "/moderationReports",
      json: options,
    });
  }
}
