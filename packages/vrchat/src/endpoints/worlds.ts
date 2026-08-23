/**
 * 世界域 —— 查询 / 搜索 / 实例。
 */
import type { VrchatHttpTransport } from "../transport.js";
import type { Instance, World } from "../types.js";

/** 世界排序方式。 */
export type WorldSort =
  | "popularity"
  | "created_at"
  | "updated_at"
  | "order"
  | "publication_date"
  | "labs_publication_date";

/** 世界搜索选项。 */
export interface SearchWorldsOptions {
  /** 关键词搜索(标题/描述/标签)。 */
  search?: string;
  /** 用户 ID:只看该用户发布的世界。 */
  userId?: string;
  /** 只看精选世界。 */
  featured?: boolean;
  /** 排序方式。 */
  sort?: WorldSort;
  /** 每页数量,默认 20,最大 100。 */
  n?: number;
  /** 分页偏移。 */
  offset?: number;
  /** 标签过滤(逗号分隔)。 */
  tag?: string;
}

export class WorldsApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 按 ID 获取世界。 */
  async getById(worldId: string): Promise<World> {
    return this.#transport.request<World>({
      method: "GET",
      path: `/worlds/${encodeURIComponent(worldId)}`,
    });
  }

  /** 获取当前用户收藏的世界。 */
  async listFavorites(options: { n?: number; offset?: number } = {}): Promise<World[]> {
    return this.#transport.request<World[]>({
      method: "GET",
      path: "/worlds/favorites",
      params: {
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 获取最近访问的世界。 */
  async listRecent(options: { n?: number; offset?: number } = {}): Promise<World[]> {
    return this.#transport.request<World[]>({
      method: "GET",
      path: "/worlds/recent",
      params: {
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 获取活跃(有人在线)的世界。 */
  async listActive(options: { n?: number; offset?: number } = {}): Promise<World[]> {
    return this.#transport.request<World[]>({
      method: "GET",
      path: "/worlds/active",
      params: {
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 搜索世界。 */
  async search(options: SearchWorldsOptions = {}): Promise<World[]> {
    return this.#transport.request<World[]>({
      method: "GET",
      path: "/worlds",
      params: {
        ...(options.search !== undefined ? { search: options.search } : {}),
        ...(options.userId !== undefined ? { userId: options.userId } : {}),
        ...(options.featured !== undefined ? { featured: options.featured ? "true" : "false" } : {}),
        ...(options.sort !== undefined ? { sort: options.sort } : {}),
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
        ...(options.tag !== undefined ? { tag: options.tag } : {}),
      },
    });
  }

  /** 获取世界的实例列表。 */
  async getInstances(worldId: string): Promise<Instance[]> {
    return this.#transport.request<Instance[]>({
      method: "GET",
      path: `/worlds/${encodeURIComponent(worldId)}/instances`,
    });
  }

  /** 给世界添加标签(仅自己的世界)。 */
  async addTags(worldId: string, tags: string[]): Promise<World> {
    return this.#transport.request<World>({
      method: "PUT",
      path: `/worlds/${encodeURIComponent(worldId)}/addTags`,
      json: { tags },
    });
  }

  /** 移除世界标签(仅自己的世界)。 */
  async removeTags(worldId: string, tags: string[]): Promise<World> {
    return this.#transport.request<World>({
      method: "PUT",
      path: `/worlds/${encodeURIComponent(worldId)}/removeTags`,
      json: { tags },
    });
  }

  /** 获取世界的最近访问时间。 */
  async getMetadata(worldId: string): Promise<World> {
    return this.#transport.request<World>({
      method: "GET",
      path: `/worlds/${encodeURIComponent(worldId)}/metadata`,
    });
  }

  /** 发布世界(将草稿发布为公开)。 */
  async publish(worldId: string, releaseStatus?: "public" | "private"): Promise<World> {
    return this.#transport.request<World>({
      method: "PUT",
      path: `/worlds/${encodeURIComponent(worldId)}/publish`,
      ...(releaseStatus !== undefined
        ? { json: { releaseStatus } }
        : {}),
    });
  }

  /** 更新世界信息。 */
  async update(
    worldId: string,
    updates: {
      name?: string;
      description?: string;
      tags?: string[];
      capacity?: number;
      imageUrl?: string;
      releaseStatus?: string;
    },
  ): Promise<World> {
    return this.#transport.request<World>({
      method: "PUT",
      path: `/worlds/${encodeURIComponent(worldId)}`,
      json: {
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.description !== undefined ? { description: updates.description } : {}),
        ...(updates.tags !== undefined ? { tags: updates.tags } : {}),
        ...(updates.capacity !== undefined ? { capacity: updates.capacity } : {}),
        ...(updates.imageUrl !== undefined ? { imageUrl: updates.imageUrl } : {}),
        ...(updates.releaseStatus !== undefined ? { releaseStatus: updates.releaseStatus } : {}),
      },
    });
  }

  /** 删除世界。 */
  async delete(worldId: string): Promise<{ success: { message: string } }> {
    return this.#transport.request<{ success: { message: string } }>({
      method: "DELETE",
      path: `/worlds/${encodeURIComponent(worldId)}`,
    });
  }
}
