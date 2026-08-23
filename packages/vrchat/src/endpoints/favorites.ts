/**
 * 收藏域 —— 收藏列表 / 添加 / 删除 / 收藏分组。
 */
import type { VrchatHttpTransport } from "../transport.js";
import type { Favorite, FavoriteType } from "../types.js";

/** 收藏列表选项。 */
export interface FavoritesOptions {
  /** 收藏类型过滤:world | avatar | friend。 */
  type?: FavoriteType;
  /** 每页数量,默认 20,最大 100。 */
  n?: number;
  /** 分页偏移。 */
  offset?: number;
  /** 标签过滤(逗号分隔),如 "my_group"。 */
  tag?: string;
}

/** 添加收藏选项。 */
export interface AddFavoriteOptions {
  type: FavoriteType;
  /** 目标 id(世界 id / 头像 id / 用户 id)。 */
  favoriteId: string;
  /** 收藏标签,如 ["avatars_1"]。 */
  tags: string[];
}

/** 收藏分组。 */
export interface FavoriteGroup {
  id: string;
  ownerId: string;
  type: FavoriteType;
  name: string;
  displayName: string;
  visible: boolean;
  /** 分组内收藏数。 */
  count?: number;
  tags: string[];
  [key: string]: unknown;
}

/** 创建收藏分组选项。 */
export interface CreateFavoriteGroupOptions {
  type: FavoriteType;
  name: string;
  /** 是否对他人可见。 */
  visible?: boolean;
  /** 分组内是否只允许自己操作。 */
  ownerOnly?: boolean;
}

export class FavoritesApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 获取收藏列表。 */
  async list(options: FavoritesOptions = {}): Promise<Favorite[]> {
    return this.#transport.request<Favorite[]>({
      method: "GET",
      path: "/favorites",
      params: {
        ...(options.type !== undefined ? { type: options.type } : {}),
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
        ...(options.tag !== undefined ? { tag: options.tag } : {}),
      },
    });
  }

  /** 添加收藏。 */
  async add(options: AddFavoriteOptions): Promise<Favorite> {
    return this.#transport.request<Favorite>({
      method: "POST",
      path: "/favorites",
      json: options,
    });
  }

  /** 删除收藏。 */
  async remove(favoriteId: string): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "DELETE",
      path: `/favorites/${encodeURIComponent(favoriteId)}`,
    });
  }

  /** 获取收藏分组列表。 */
  async listGroups(type: FavoriteType, options: { n?: number; offset?: number } = {}): Promise<FavoriteGroup[]> {
    return this.#transport.request<FavoriteGroup[]>({
      method: "GET",
      path: "/favorite/groups",
      params: {
        type,
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 按分组获取收藏列表(分组名下的所有收藏)。 */
  async getByGroup(
    type: FavoriteType,
    groupName: string,
    userId: string,
    options: { n?: number; offset?: number } = {},
  ): Promise<Favorite[]> {
    return this.#transport.request<Favorite[]>({
      method: "GET",
      path: `/favorite/group/${encodeURIComponent(type)}/${encodeURIComponent(groupName)}/${encodeURIComponent(userId)}`,
      params: {
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 创建收藏分组。 */
  async createGroup(options: CreateFavoriteGroupOptions): Promise<FavoriteGroup> {
    return this.#transport.request<FavoriteGroup>({
      method: "POST",
      path: "/favorite/groups",
      json: {
        type: options.type,
        name: options.name,
        ...(options.visible !== undefined ? { visible: options.visible } : {}),
        ...(options.ownerOnly !== undefined ? { ownerOnly: options.ownerOnly } : {}),
      },
    });
  }

  /** 删除收藏分组。 */
  async deleteGroup(groupId: string): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "DELETE",
      path: `/favorite/groups/${encodeURIComponent(groupId)}`,
    });
  }
}
