/**
 * 头像域 —— 查询 / 搜索 / 选择。
 */
import type { VrchatHttpTransport } from "../transport.js";
import type { Avatar, CurrentUser } from "../types.js";

/** 头像搜索选项。 */
export interface SearchAvatarsOptions {
  /** 关键词搜索。 */
  search?: string;
  /** 只看精选头像。 */
  featured?: boolean;
  /**
   * 市场过滤:paid | free | all(2026-08-23 实测:文本搜索必须指定,
   * 否则 400 "Text search queries must specify a marketplace";默认 all)。
   */
  marketplace?: "paid" | "free" | "all";
  /** 只看指定用户发布的头像。 */
  userId?: string;
  /** 每页数量,默认 20,最大 100。 */
  n?: number;
  /** 分页偏移。 */
  offset?: number;
  /** 排序:popularity | created_at | updated_at | order。 */
  sort?: string;
  /** 标签过滤(逗号分隔)。 */
  tag?: string;
  /** 发布状态:published | hidden | all。 */
  releaseStatus?: string;
}

/** 头像风格。 */
export interface AvatarStyle {
  id: string;
  name: string;
  [key: string]: unknown;
}

export class AvatarsApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 按 ID 获取头像。 */
  async getById(avatarId: string): Promise<Avatar> {
    return this.#transport.request<Avatar>({
      method: "GET",
      path: `/avatars/${encodeURIComponent(avatarId)}`,
    });
  }

  /** 搜索头像(文本搜索自动附带 marketplace=all,否则 API 400)。 */
  async search(options: SearchAvatarsOptions = {}): Promise<Avatar[]> {
    return this.#transport.request<Avatar[]>({
      method: "GET",
      path: "/avatars",
      params: {
        ...(options.search !== undefined ? { search: options.search } : {}),
        ...(options.featured !== undefined ? { featured: options.featured ? "true" : "false" } : {}),
        ...(options.marketplace !== undefined
          ? { marketplace: options.marketplace }
          : options.search !== undefined
            ? { marketplace: "all" }
            : {}),
        ...(options.userId !== undefined ? { userId: options.userId } : {}),
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
        ...(options.sort !== undefined ? { sort: options.sort } : {}),
        ...(options.tag !== undefined ? { tag: options.tag } : {}),
        ...(options.releaseStatus !== undefined ? { releaseStatus: options.releaseStatus } : {}),
      },
    });
  }

  /** 获取当前用户的头像列表(包含已拥有)。 */
  async listOwned(userId: string): Promise<Avatar[]> {
    return this.#transport.request<Avatar[]>({
      method: "GET",
      path: "/avatars",
      params: { userId, releaseStatus: "all", n: 100 },
    });
  }

  /** 获取当前用户收藏的头像。 */
  async listFavorites(options: { n?: number; offset?: number } = {}): Promise<Avatar[]> {
    return this.#transport.request<Avatar[]>({
      method: "GET",
      path: "/avatars/favorites",
      params: {
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 获取授权头像列表(平台授权,不含公开头像)。 */
  async listLicensed(options: { n?: number; offset?: number } = {}): Promise<Avatar[]> {
    return this.#transport.request<Avatar[]>({
      method: "GET",
      path: "/avatars/licensed",
      params: {
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }

  /** 获取头像风格列表(公开,无需登录)。 */
  async getStyles(): Promise<AvatarStyle[]> {
    return this.#transport.request<AvatarStyle[]>({
      method: "GET",
      path: "/avatarStyles",
    });
  }

  /** 选择当前使用的头像。 */
  async selectCurrent(avatarId: string): Promise<CurrentUser> {
    return this.#transport.request<CurrentUser>({
      method: "PUT",
      path: `/avatars/${encodeURIComponent(avatarId)}/select`,
    });
  }

  /** 选择回退头像(备用)。 */
  async selectFallback(avatarId: string): Promise<CurrentUser> {
    return this.#transport.request<CurrentUser>({
      method: "PUT",
      path: `/avatars/${encodeURIComponent(avatarId)}/selectFallback`,
    });
  }
}
