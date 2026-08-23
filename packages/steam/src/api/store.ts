/**
 * store 域 —— Storefront API(无需 key)。
 * 本地化:cc(国家码)+ l(语言码),如 cc=cn&l=schinese。
 */
import type { SteamHttpTransport } from "../http.js";
import { SteamEndpoints } from "../endpoints.js";
import type {
  AppDetailsResult,
  AppListEntry,
  AppReview,
  AppReviewsResult,
  StoreSearchItem,
} from "../types.js";

export interface StoreLocaleOptions {
  cc?: string;
  l?: string;
}

export interface GetAppDetailsOptions extends StoreLocaleOptions {
  /** 字段过滤(如 basic),减少响应体积。 */
  filters?: string;
}

export interface GetAppReviewsOptions extends StoreLocaleOptions {
  /** recent(默认)/ updated / all。 */
  filter?: "recent" | "updated" | "all";
  /** 每页条数(默认 20,上限 100)。 */
  numPerPage?: number;
  /** 分页游标(从上次响应的 cursor 透传)。 */
  cursor?: string;
  /** purchase_type:0 全部(默认)/ 1 付费 / 2 免费。 */
  purchaseType?: 0 | 1 | 2;
  /** 只看中文评测(需 l=schinese 时生效;默认按语言返回)。 */
  language?: string;
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

  /**
   * 商店评测(appreviews,公开无需 key)。返回结构化评测列表 + 好评率摘要。
   * filter=all 可翻页(cursor 透传)拉全部;recent 按时间倒序。
   */
  async getAppReviews(appid: number, options: GetAppReviewsOptions = {}): Promise<AppReviewsResult> {
    const params: Record<string, string | number | undefined> = {
      json: 1,
      filter: options.filter ?? "recent",
      num_per_page: options.numPerPage ?? 20,
      purchase_type: options.purchaseType ?? 0,
      ...(options.cc !== undefined ? { cc: options.cc } : {}),
      ...(options.l !== undefined ? { l: options.l } : {}),
      ...(options.language !== undefined ? { language: options.language } : {}),
      ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
    };
    const body = await this.transport.request<AppReviewsResult>({
      host: "store",
      path: SteamEndpoints.store.appReviews(appid),
      params,
      noCache: options.cursor !== undefined, // 翻页结果不缓存,避免串页
    });
    // 兼容旧字段:部分响应 reviews 数组里的 author 可能缺字段,宽松处理。
    body.reviews = (body.reviews ?? []) as AppReview[];
    return body;
  }

  #localeParams(options: StoreLocaleOptions): Record<string, string> {
    return {
      ...(options.cc !== undefined ? { cc: options.cc } : {}),
      ...(options.l !== undefined ? { l: options.l } : {}),
    };
  }
}
