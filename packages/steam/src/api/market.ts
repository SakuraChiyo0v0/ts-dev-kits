/**
 * market 域 —— 市场价格 / 市场搜索 / 订单簿 / 价格历史 / 我的挂单与成交
 * (community;仅只读,零写操作)。
 * 价格接口有较严限流(priceoverview 约 20/分钟),默认命中 TTL 缓存以缓解;
 * 我的挂单/成交需登录 cookie(mylistings / myhistory)。
 */
import type { SteamHttpTransport } from "../http.js";
import { SteamEndpoints } from "../endpoints.js";
import { SteamError } from "../errors.js";
import type {
  MarketPriceOverview,
  MarketSearchResponse,
  OrderHistogramResult,
  PriceHistoryResult,
  MyListingsResult,
  MyHistoryResult,
} from "../types.js";

export interface GetPriceOverviewOptions {
  /** 货币代码:1=USD,3=EUR,5=GBP,23=CNY;默认 1。 */
  currency?: number;
  /** 覆盖缓存(默认命中 TTL 缓存)。 */
  noCache?: boolean;
}

export type MarketSortColumn = "name" | "price" | "quantity" | "popular";
export type MarketSortDirection = "asc" | "desc";

export interface MarketSearchOptions {
  appid?: number;
  query?: string;
  sort?: MarketSortColumn;
  sortDir?: MarketSortDirection;
  priceMin?: number;
  priceMax?: number;
  /** 起始位置,默认 0。 */
  start?: number;
  /** 条数;注意 Steam 始终最多返回约 10 条/页。 */
  count?: number;
  searchDescriptions?: boolean;
  noCache?: boolean;
}

export interface GetItemOrdersHistogramOptions {
  /** 货币代码,默认 1(USD)。 */
  currency?: number;
  /** 语言,默认 english。 */
  language?: string;
  noCache?: boolean;
}

export interface GetPriceHistoryOptions {
  noCache?: boolean;
}

export class MarketApi {
  constructor(private readonly transport: SteamHttpTransport) {}

  /** 单件即时价(priceoverview);success:false 表示无该物品数据。 */
  async getPriceOverview(
    appid: number,
    marketHashName: string,
    options: GetPriceOverviewOptions = {},
  ): Promise<MarketPriceOverview> {
    const params: Record<string, string | number | undefined> = {
      appid,
      market_hash_name: marketHashName,
      currency: options.currency ?? 1,
    };
    return this.transport.request<MarketPriceOverview>({
      host: "community",
      path: SteamEndpoints.community.marketPriceOverview,
      params,
      ...(options.noCache !== undefined ? { noCache: options.noCache } : {}),
    });
  }

  /** 市场搜索(search/render,norender=1 返回 JSON)。 */
  async search(options: MarketSearchOptions = {}): Promise<MarketSearchResponse> {
    const params: Record<string, string | number | undefined> = {
      norender: 1,
      ...(options.appid !== undefined ? { appid: options.appid } : {}),
      ...(options.query !== undefined ? { query: options.query } : {}),
      ...(options.sort !== undefined ? { sort_column: options.sort } : {}),
      ...(options.sortDir !== undefined ? { sort_dir: options.sortDir } : {}),
      ...(options.priceMin !== undefined ? { price_min: options.priceMin } : {}),
      ...(options.priceMax !== undefined ? { price_max: options.priceMax } : {}),
      ...(options.start !== undefined ? { start: options.start } : {}),
      ...(options.count !== undefined ? { count: options.count } : {}),
      ...(options.searchDescriptions !== undefined
        ? { search_descriptions: options.searchDescriptions ? 1 : 0 }
        : {}),
    };
    return this.transport.request<MarketSearchResponse>({
      host: "community",
      path: SteamEndpoints.community.marketSearch,
      params,
      ...(options.noCache !== undefined ? { noCache: options.noCache } : {}),
    });
  }

  /** 买卖挂单深度(订单簿,itemordershistogram);登录态更稳,匿名亦可调。 */
  async getItemOrdersHistogram(
    appid: number,
    marketHashName: string,
    options: GetItemOrdersHistogramOptions = {},
  ): Promise<OrderHistogramResult> {
    return this.transport.request<OrderHistogramResult>({
      host: "community",
      path: SteamEndpoints.community.itemOrdersHistogram,
      method: "POST",
      params: {
        language: options.language ?? "english",
        currency: options.currency ?? 1,
        norender: 1,
      },
      form: {
        appid,
        market_hash_name: marketHashName,
      },
      withCookies: true,
      ...(options.noCache !== undefined ? { noCache: options.noCache } : {}),
    });
  }

  /** 历史价格曲线(pricehistory);登录态更稳,匿名亦可调。 */
  async getPriceHistory(
    appid: number,
    marketHashName: string,
    options: GetPriceHistoryOptions = {},
  ): Promise<PriceHistoryResult> {
    return this.transport.request<PriceHistoryResult>({
      host: "community",
      path: SteamEndpoints.community.priceHistory,
      params: {
        appid,
        market_hash_name: marketHashName,
      },
      withCookies: true,
      ...(options.noCache !== undefined ? { noCache: options.noCache } : {}),
    });
  }

  /** 我的挂单(mylistings);需登录 cookie,否则抛 LOGIN_REQUIRED。 */
  async getMyListings(): Promise<MyListingsResult> {
    this.#assertLoggedIn();
    return this.transport.request<MyListingsResult>({
      host: "community",
      path: SteamEndpoints.community.myListings,
      params: { norender: 1 },
      withCookies: true,
      noCache: true,
    });
  }

  /** 我的成交历史(myhistory);需登录 cookie,否则抛 LOGIN_REQUIRED。 */
  async getMyHistory(): Promise<MyHistoryResult> {
    this.#assertLoggedIn();
    return this.transport.request<MyHistoryResult>({
      host: "community",
      path: SteamEndpoints.community.myHistory,
      params: { norender: 1 },
      withCookies: true,
      noCache: true,
    });
  }

  #assertLoggedIn(): void {
    if (this.transport.cookie === undefined) {
      throw new SteamError("LOGIN_REQUIRED", "该接口需要登录态(登录或导入 cookie)");
    }
  }
}
