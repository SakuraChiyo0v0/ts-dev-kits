/**
 * 认证域 —— 会话检查 / 当前用户 / 登出 / 全局配置。
 */
import type { VrchatHttpTransport } from "../transport.js";
import type { ApiConfig, CurrentUser } from "../types.js";

export class AuthApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 检查会话有效性:有效返回 true,失效返回 false(不抛错)。 */
  async checkSession(): Promise<boolean> {
    try {
      const result = await this.#transport.request<{ ok?: string }>({
        method: "GET",
        path: "/auth",
      });
      return result.ok === "true" || result.ok === "ok";
    } catch {
      return false;
    }
  }

  /** 获取当前登录用户(会话失效抛 AUTH_EXPIRED)。 */
  async currentUser(): Promise<CurrentUser> {
    return this.#transport.request<CurrentUser>({ method: "GET", path: "/auth/user" });
  }

  /** 登出并清除本地会话 cookie。 */
  async logout(): Promise<void> {
    try {
      await this.#transport.request<unknown>({ method: "PUT", path: "/logout" });
    } finally {
      this.#transport.clearCookie();
    }
  }

  /** 全局配置。 */
  async getConfig(): Promise<ApiConfig> {
    return this.#transport.request<ApiConfig>({ method: "GET", path: "/config" });
  }

  /** 收藏上限(各类收藏的数量限制)。 */
  async getFavoriteLimits(): Promise<FavoriteLimits> {
    return this.#transport.request<FavoriteLimits>({
      method: "GET",
      path: "/auth/user/favoritelimits",
    });
  }
}

/** 收藏上限。 */
export interface FavoriteLimits {
  avatar: number;
  friend: number;
  world: number;
  [key: string]: unknown;
}
