/**
 * 实例域 —— 查询 / 创建 / 短码。
 */
import type { VrchatHttpTransport } from "../transport.js";
import type { Instance, InstanceType } from "../types.js";

/** 创建实例选项。 */
export interface CreateInstanceOptions {
  /** 实例类型。 */
  type: InstanceType;
  /** 区域:us | use | eu | jp。 */
  region?: string;
  /** 实例最大人数(需权限)。 */
  maxCapacity?: number;
  /** 群组 ID(群组实例专用)。 */
  groupId?: string;
  /** 群组角色 ID 列表(群组实例专用)。 */
  groupAccessType?: string;
}

export class InstancesApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 按 世界ID:实例ID 获取实例。 */
  async getById(worldId: string, instanceId: string): Promise<Instance> {
    return this.#transport.request<Instance>({
      method: "GET",
      path: `/instances/${encodeURIComponent(worldId)}:${encodeURIComponent(instanceId)}`,
    });
  }

  /** 按短码获取实例。 */
  async getByShortName(shortName: string): Promise<Instance> {
    return this.#transport.request<Instance>({
      method: "GET",
      path: `/instances/s/${encodeURIComponent(shortName)}`,
    });
  }

  /** 获取实例短码(返回 { shortName })。 */
  async getShortName(worldId: string, instanceId: string): Promise<{ shortName: string }> {
    return this.#transport.request<{ shortName: string }>({
      method: "GET",
      path: `/instances/${encodeURIComponent(worldId)}:${encodeURIComponent(instanceId)}/shortName`,
    });
  }

  /** 创建实例,返回实例 id。 */
  async create(worldId: string, options: CreateInstanceOptions): Promise<Instance> {
    return this.#transport.request<Instance>({
      method: "POST",
      path: "/instances",
      json: {
        worldId,
        type: options.type,
        ...(options.region !== undefined ? { region: options.region } : {}),
        ...(options.maxCapacity !== undefined ? { maxCapacity: options.maxCapacity } : {}),
        ...(options.groupId !== undefined ? { groupId: options.groupId } : {}),
        ...(options.groupAccessType !== undefined
          ? { groupAccessType: options.groupAccessType }
          : {}),
      },
    });
  }

  /** 获取最近访问的实例。 */
  async listRecent(options: { n?: number; offset?: number } = {}): Promise<Instance[]> {
    return this.#transport.request<Instance[]>({
      method: "GET",
      path: "/instances/recent",
      params: {
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }
}
