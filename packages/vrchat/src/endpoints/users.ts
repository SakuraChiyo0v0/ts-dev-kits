/**
 * 用户域 —— 查询 / 搜索 / 好友状态。
 */
import type { VrchatHttpTransport } from "../transport.js";
import type { Avatar, CurrentUser, FriendStatus, Group, LimitedUser, World } from "../types.js";

/** 用户搜索选项。 */
export interface SearchUsersOptions {
  /** 用户名模糊搜索。 */
  search?: string;
  /** 开发者类型过滤:developer | trusted | known | user | newUser | visitor。 */
  developerType?: string;
  /** 每页数量,默认 20,最大 100。 */
  n?: number;
  /** 分页偏移。 */
  offset?: number;
  /** 活跃用户过滤:active | joinme | askme | busy。 */
  active?: string;
}

/** 用户已收藏/创建的世界列表选项。 */
export interface UserWorldsOptions {
  /** 排序:created_at | updated_at | last_activity。 */
  sort?: string;
  n?: number;
  offset?: number;
}

/** 更新当前用户信息选项。 */
export interface UpdateUserOptions {
  /** 在线状态:active | join me | ask me | busy | offline。 */
  status?: string;
  /** 自定义状态文本(最长 32 字符)。 */
  statusDescription?: string;
  /** 个人简介。 */
  bio?: string;
  /** 个人简介链接。 */
  bioLinks?: string[];
  /** 是否允许他人克隆头像。 */
  allowAvatarCopying?: boolean;
}

/** 用户备注。 */
export interface UserNote {
  id: string;
  targetUserId: string;
  note: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

/** 创建/更新用户备注选项。 */
export interface UserNoteOptions {
  targetUserId: string;
  note: string;
}

export class UsersApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 按 ID 获取用户。 */
  async getById(userId: string): Promise<LimitedUser> {
    return this.#transport.request<LimitedUser>({
      method: "GET",
      path: `/users/${encodeURIComponent(userId)}`,
    });
  }

  /** 获取用户的公开资料(比 getById 更完整,官方 /profile 端点)。 */
  async getProfile(userId: string): Promise<LimitedUser> {
    return this.#transport.request<LimitedUser>({
      method: "GET",
      path: `/profile/${encodeURIComponent(userId)}`,
    });
  }

  /** 按用户名精确获取用户。 */
  async getByUsername(username: string): Promise<LimitedUser> {
    return this.#transport.request<LimitedUser>({
      method: "GET",
      path: `/users/${encodeURIComponent(username)}/name`,
    });
  }

  /** 搜索用户。 */
  async search(options: SearchUsersOptions = {}): Promise<LimitedUser[]> {
    return this.#transport.request<LimitedUser[]>({
      method: "GET",
      path: "/users",
      params: {
        ...(options.search !== undefined ? { search: options.search } : {}),
        ...(options.developerType !== undefined ? { developerType: options.developerType } : {}),
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
        ...(options.active !== undefined ? { active: options.active } : {}),
      },
    });
  }

  /** 获取好友关系状态(是否好友 / 待处理申请)。 */
  async getFriendStatus(userId: string): Promise<FriendStatus> {
    return this.#transport.request<FriendStatus>({
      method: "GET",
      path: `/user/${encodeURIComponent(userId)}/friendStatus`,
    });
  }

  /** 获取用户发布的世界列表。 */
  async getUserWorlds(userId: string, options: UserWorldsOptions = {}): Promise<World[]> {
    return this.#transport.request<World[]>({
      method: "GET",
      path: `/users/${encodeURIComponent(userId)}/worlds`,
      params: {
        ...(options.sort !== undefined ? { sort: options.sort } : {}),
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 获取用户加入的群组。 */
  async getGroups(userId: string): Promise<Group[]> {
    return this.#transport.request<Group[]>({
      method: "GET",
      path: `/users/${encodeURIComponent(userId)}/groups`,
    });
  }

  /** 获取与某用户的共同好友。 */
  async getMutuals(userId: string): Promise<LimitedUser[]> {
    return this.#transport.request<LimitedUser[]>({
      method: "GET",
      path: `/users/${encodeURIComponent(userId)}/mutuals`,
    });
  }

  /** 获取用户的当前头像。 */
  async getAvatar(userId: string): Promise<Avatar> {
    return this.#transport.request<Avatar>({
      method: "GET",
      path: `/users/${encodeURIComponent(userId)}/avatar`,
    });
  }

  /** 获取活跃用户(需登录)。 */
  async listActive(options: { n?: number; offset?: number } = {}): Promise<LimitedUser[]> {
    return this.#transport.request<LimitedUser[]>({
      method: "GET",
      path: "/users/active",
      params: {
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 更新当前用户信息(状态/状态文本/简介等)。 */
  async updateCurrent(userId: string, options: UpdateUserOptions): Promise<CurrentUser> {
    return this.#transport.request<CurrentUser>({
      method: "PUT",
      path: `/users/${encodeURIComponent(userId)}`,
      json: {
        ...(options.status !== undefined ? { status: options.status } : {}),
        ...(options.statusDescription !== undefined
          ? { statusDescription: options.statusDescription }
          : {}),
        ...(options.bio !== undefined ? { bio: options.bio } : {}),
        ...(options.bioLinks !== undefined ? { bioLinks: options.bioLinks } : {}),
        ...(options.allowAvatarCopying !== undefined
          ? { allowAvatarCopying: options.allowAvatarCopying }
          : {}),
      },
    });
  }

  /** 获取用户备注列表。 */
  async listNotes(options: { n?: number; offset?: number } = {}): Promise<UserNote[]> {
    return this.#transport.request<UserNote[]>({
      method: "GET",
      path: "/userNotes",
      params: {
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 创建用户备注。 */
  async createNote(options: UserNoteOptions): Promise<UserNote> {
    return this.#transport.request<UserNote>({
      method: "POST",
      path: "/userNotes",
      json: options,
    });
  }

  /** 更新用户备注。 */
  async updateNote(userNoteId: string, note: string): Promise<UserNote> {
    return this.#transport.request<UserNote>({
      method: "PUT",
      path: `/userNotes/${encodeURIComponent(userNoteId)}`,
      json: { note },
    });
  }

  /** 删除用户备注。 */
  async deleteNote(userNoteId: string): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "DELETE",
      path: `/userNotes/${encodeURIComponent(userNoteId)}`,
    });
  }
}
