/**
 * store 域 —— Storefront API(无需 key)。
 * 本地化:cc(国家码)+ l(语言码),如 cc=cn&l=schinese。
 */
import type { SteamHttpTransport } from "../http.js";
import { SteamEndpoints } from "../endpoints.js";
import type { AppDetailsResult, AppListEntry, StoreSearchItem } from "../types.js";

export interface StoreLocaleOptions {
  cc?: string;
  l?: string;
}

export interface GetAppDetailsOptions extends StoreLocaleOptions {
  /** 字段过滤(如 basic),减少响应体积。 */
  filters?: string;
}

export class StoreApi {
  constructor(private readonly transport: SteamHttpTransport) {}

  /** 商店页详情(appdetails;多个 appid 逗号分隔)。 */
  async getAppDetails(
    appIds: number[],
    options: GetAppDetailsOptions = {},
  ): Promise<Record<string, AppDetailsResult>> {
    if (appIds.length === 0) {
      return {};
    }
    const params: Record<string, string | number | undefined> = {
      appids: appIds.join(","),
      ...(options.cc !== undefined ? { cc: options.cc } : {}),
      ...(options.l !== undefined ? { l: options.l } : {}),
      ...(options.filters !== undefined ? { filters: options.filters } : {}),
    };
    return this.transport.request<Record<string, AppDetailsResult>>({
      host: "store",
      path: SteamEndpoints.store.appDetails,
      params,
    });
  }

  /** 首页推荐(featured)。 */
  async getFeatured(options: StoreLocaleOptions = {}): Promise<Record<string, unknown>> {
    return this.transport.request<Record<string, unknown>>({
      host: "store",
      path: SteamEndpoints.store.featured,
      params: this.#localeParams(options),
    });
  }

  /** 首页推荐分类(featuredcategories)。 */
  async getFeaturedCategories(options: StoreLocaleOptions = {}): Promise<Record<string, unknown>> {
    return this.transport.request<Record<string, unknown>>({
      host: "store",
      path: SteamEndpoints.store.featuredCategories,
      params: this.#localeParams(options),
    });
  }

  /** 捆绑包详情(packagedetails)。 */
  async getPackageDetails(
    packageIds: number[],
  ): Promise<Record<string, { success: boolean; data?: Record<string, unknown> }>> {
    if (packageIds.length === 0) {
      return {};
    }
    return this.transport.request<Record<string, { success: boolean; data?: Record<string, unknown> }>>({
      host: "store",
      path: SteamEndpoints.store.packageDetails,
      params: { packageids: packageIds.join(",") },
    });
  }

  /** DLC 列表(dlcforapp;返回形状以实际为准,类型宽松)。 */
  async getDlcForApp(appid: number, options: StoreLocaleOptions = {}): Promise<unknown> {
    return this.transport.request<unknown>({
      host: "store",
      path: SteamEndpoints.store.dlcForApp,
      params: { appid, ...this.#localeParams(options) },
    });
  }

  /** 商店搜索(storesearch)。 */
  async search(query: string, options: StoreLocaleOptions = {}): Promise<StoreSearchItem[]> {
    const body = await this.transport.request<{ items?: StoreSearchItem[] }>({
      host: "store",
      path: SteamEndpoints.store.storeSearch,
      params: { term: query, ...this.#localeParams(options) },
    });
    return body.items ?? [];
  }

  /** 分类内应用(getappsincategory;返回形状以实际为准)。 */
  async getAppsInCategory(category: string, options: StoreLocaleOptions = {}): Promise<unknown> {
    return this.transport.request<unknown>({
      host: "store",
      path: SteamEndpoints.store.appsInCategory,
      params: { category, ...this.#localeParams(options) },
    });
  }

  /** 类型内应用(getappsingenre;返回形状以实际为准)。 */
  async getAppsInGenre(genre: string, options: StoreLocaleOptions = {}): Promise<unknown> {
    return this.transport.request<unknown>({
      host: "store",
      path: SteamEndpoints.store.appsInGenre,
      params: { genre, ...this.#localeParams(options) },
    });
  }

  /** 促销页(salepage,slug 参数;返回形状以实际为准)。 */
  async getSalePage(slug: string, options: StoreLocaleOptions = {}): Promise<unknown> {
    return this.transport.request<unknown>({
      host: "store",
      path: SteamEndpoints.store.salePage,
      params: { slug, ...this.#localeParams(options) },
    });
  }

  /** 应用全表(GetAppList/v2,需 key;约 15 万条,建议配合缓存)。 */
  async getAppList(): Promise<AppListEntry[]> {
    const body = await this.transport.request<{ applist: { apps?: AppListEntry[] } }>({
      host: "api",
      path: SteamEndpoints.api.appList,
      withKey: true,
    });
    return body.applist.apps ?? [];
  }

  #localeParams(options: StoreLocaleOptions): Record<string, string> {
    return {
      ...(options.cc !== undefined ? { cc: options.cc } : {}),
      ...(options.l !== undefined ? { l: options.l } : {}),
    };
  }
}
