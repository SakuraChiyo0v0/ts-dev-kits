/**
 * 权限域 —— 账号权限位查询。
 */
import type { VrchatHttpTransport } from "../transport.js";
import type { Permission } from "../types.js";

export class PermissionsApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 获取全部权限位。 */
  async list(): Promise<Permission[]> {
    return this.#transport.request<Permission[]>({
      method: "GET",
      path: "/permissions",
    });
  }

  /** 按 ID 获取权限位。 */
  async getById(permissionId: string): Promise<Permission> {
    return this.#transport.request<Permission>({
      method: "GET",
      path: `/permissions/${encodeURIComponent(permissionId)}`,
    });
  }
}
