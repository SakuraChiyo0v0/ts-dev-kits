/**
 * inventory 域 —— 玩家库存(community,公开可读;私有需登录 cookie,默认不缓存)
 * 与物品定义(Web API,publisher key)。
 */
import type { SteamHttpTransport } from "../http.js";
import { SteamEndpoints } from "../endpoints.js";
import { SteamError } from "../errors.js";
import { resolveToSteamId64 } from "../internal-resolve.js";
import type { InventoryResponse, ItemDefsResult, SteamIdInput } from "../types.js";

export interface GetInventoryOptions {
  /** 单次条数,默认 75。 */
  count?: number;
  /** 翻页游标(上次响应的 last_assetid)。 */
  startAssetId?: string;
  /** 本地化语言,如 schinese。 */
  language?: string;
  /** 覆盖"默认不缓存"。 */
  noCache?: boolean;
}

export interface GetItemDefsOptions {
  /** 本地化语言,如 schinese。 */
  language?: string;
  noCache?: boolean;
}

export class InventoryApi {
  /**
   * @param ownSteamIdProvider 返回登录会话的 steamid(无则 undefined),getOwnInventory 使用。
   */
  constructor(
    private readonly transport: SteamHttpTransport,
    private readonly ownSteamIdProvider?: () => string | undefined,
  ) {}

  /**
   * 玩家库存(GET /inventory/:steamid/:appid/:contextid)。
   * 库存数据可变,默认不命中 TTL 缓存;私有库存返回空资产(需登录 cookie)。
   */
  async getInventory(
    steamid: SteamIdInput,
    appid: number,
    contextId: string,
    options: GetInventoryOptions = {},
  ): Promise<InventoryResponse> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    return this.#fetchInventory(id64, appid, contextId, options);
  }

  /**
   * 自己的库存(需登录 cookie;steamid 取自登录会话)。
   * "多 App"支持:对不同 (appid, contextId) 均可调用。
   */
  async getOwnInventory(
    appid: number,
    contextId: string,
    options: GetInventoryOptions = {},
  ): Promise<InventoryResponse> {
    const id64 = this.#ownSteamId();
    return this.#fetchInventory(id64, appid, contextId, options);
  }

  /**
   * 物品定义(ISteamInventory/GetItemDefs/v1,需 publisher key)。
   * 无 publisherKey 时抛 CONFIGURATION。
   */
  async getItemDefs(appid: number, options: GetItemDefsOptions = {}): Promise<ItemDefsResult> {
    if (this.transport.publisherKey === undefined) {
      throw new SteamError("CONFIGURATION", "GetItemDefs 需要 publisherKey");
    }
    const params: Record<string, string | number | undefined> = {
      appid,
      ...(options.language !== undefined ? { language: options.language } : {}),
    };
    const body = await this.transport.request<{ result: unknown[] }>({
      host: "api",
      path: SteamEndpoints.api.itemDefs,
      params,
      withKey: true,
      ...(options.noCache !== undefined ? { noCache: options.noCache } : {}),
    });
    return { items: (body.result ?? []) as ItemDefsResult["items"] };
  }

  #fetchInventory(
    id64: string,
    appid: number,
    contextId: string,
    options: GetInventoryOptions,
  ): Promise<InventoryResponse> {
    const params: Record<string, string | number | undefined> = {
      ...(options.language !== undefined ? { l: options.language } : {}),
      ...(options.count !== undefined ? { count: options.count } : {}),
      ...(options.startAssetId !== undefined ? { start_assetid: options.startAssetId } : {}),
    };
    return this.transport.request<InventoryResponse>({
      host: "community",
      path: SteamEndpoints.community.inventory(id64, appid, contextId),
      params,
      noCache: options.noCache ?? true,
    });
  }

  #ownSteamId(): string {
    const id64 = this.ownSteamIdProvider?.();
    if (id64 === undefined || this.transport.cookie === undefined) {
      throw new SteamError(
        "LOGIN_REQUIRED",
        "getOwnInventory 需要登录态(登录或导入 cookie,且会话含 steamid)",
      );
    }
    return id64;
  }
}
