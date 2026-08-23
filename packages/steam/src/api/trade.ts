/**
 * trade 域(只读)—— 交易报价 / 交易历史 / 交易链接。
 * Web API 侧(IEconService,需 key)与社区侧(交易链接,需登录 cookie)。
 * 合规红线:只读,绝不提供创建/接受/取消报价等写操作。
 */
import type { SteamHttpTransport } from "../http.js";
import { SteamEndpoints } from "../endpoints.js";
import { SteamError } from "../errors.js";
import { steamId64ToAccountId } from "../steamid.js";
import type {
  TradeOffersResult,
  TradeOfferResult,
  TradeHistoryResult,
  TradeUrlResult,
} from "../types.js";

export interface GetTradeOffersOptions {
  /** 是否返回发出的报价,默认 true。 */
  getSentOffers?: boolean;
  /** 是否返回收到的报价,默认 true。 */
  getReceivedOffers?: boolean;
  /** 是否返回物品描述,默认 true。 */
  getDescriptions?: boolean;
  /** 是否仅活跃报价,默认 false(全部)。 */
  activeOnly?: boolean;
  /** 是否仅历史报价,默认 false。 */
  historicalOnly?: boolean;
  language?: string;
}

export interface GetTradeHistoryOptions {
  /** 最大条数,默认 100。 */
  maxTrades?: number;
  /** 只取此时间之后(秒)。 */
  startAfterTime?: number;
  /** 只取此交易 ID 之后。 */
  startAfterTradeId?: number;
  /** 是否返回物品描述,默认 true。 */
  getDescriptions?: boolean;
  language?: string;
}

export class TradeApi {
  /**
   * @param ownSteamIdProvider 返回登录会话的 steamid(无则 undefined),getTradeUrl 使用。
   */
  constructor(
    private readonly transport: SteamHttpTransport,
    private readonly ownSteamIdProvider?: () => string | undefined,
  ) {}

  /** 交易报价(发出+收到);需 key;账号需在 Steamworks 开通 Web API 交易权限。 */
  async getTradeOffers(options: GetTradeOffersOptions = {}): Promise<TradeOffersResult> {
    this.#assertApiKey();
    const params: Record<string, string | number | undefined> = {
      get_sent_offers: options.getSentOffers ?? true ? 1 : 0,
      get_received_offers: options.getReceivedOffers ?? true ? 1 : 0,
      get_descriptions: options.getDescriptions ?? true ? 1 : 0,
      ...(options.activeOnly !== undefined ? { active_only: options.activeOnly ? 1 : 0 } : {}),
      ...(options.historicalOnly !== undefined
        ? { historical_only: options.historicalOnly ? 1 : 0 }
        : {}),
      ...(options.language !== undefined ? { language: options.language } : {}),
    };
    const result = await this.transport.request<{
      response: {
        trade_offers_sent?: unknown[];
        trade_offers_received?: unknown[];
        descriptions?: Record<string, unknown>;
      };
    }>({ host: "api", path: SteamEndpoints.api.tradeOffers, params, withKey: true });
    return {
      tradeOffersSent: (result.response.trade_offers_sent ?? []) as TradeOffersResult["tradeOffersSent"],
      tradeOffersReceived: (result.response.trade_offers_received ??
        []) as TradeOffersResult["tradeOffersReceived"],
      ...(result.response.descriptions !== undefined
        ? { descriptions: result.response.descriptions }
        : {}),
    };
  }

  /** 单笔交易报价详情;需 key。 */
  async getTradeOffer(tradeOfferId: string | number): Promise<TradeOfferResult> {
    this.#assertApiKey();
    const result = await this.transport.request<{ response: TradeOfferResult }>({
      host: "api",
      path: SteamEndpoints.api.tradeOffer,
      params: { tradeofferid: String(tradeOfferId) },
      withKey: true,
    });
    return result.response;
  }

  /** 交易历史;需 key。 */
  async getTradeHistory(options: GetTradeHistoryOptions = {}): Promise<TradeHistoryResult> {
    this.#assertApiKey();
    const params: Record<string, string | number | undefined> = {
      ...(options.maxTrades !== undefined ? { max_trades: options.maxTrades } : {}),
      ...(options.startAfterTime !== undefined
        ? { start_after_time: options.startAfterTime }
        : {}),
      ...(options.startAfterTradeId !== undefined
        ? { start_after_tradeid: options.startAfterTradeId }
        : {}),
      ...(options.getDescriptions !== undefined
        ? { get_descriptions: options.getDescriptions ? 1 : 0 }
        : {}),
      ...(options.language !== undefined ? { language: options.language } : {}),
    };
    const result = await this.transport.request<{
      response: { trades?: unknown[]; more?: boolean };
    }>({ host: "api", path: SteamEndpoints.api.tradeHistory, params, withKey: true });
    return {
      trades: (result.response.trades ?? []) as TradeHistoryResult["trades"],
      more: result.response.more ?? false,
    };
  }

  /**
   * 我的交易链接(tradeoffer/new 页解析 g_strTradeOfferAccessToken);
   * 需登录 cookie + 会话 steamid。
   */
  async getTradeUrl(): Promise<TradeUrlResult> {
    const id64 = this.ownSteamIdProvider?.();
    if (id64 === undefined || this.transport.cookie === undefined) {
      throw new SteamError(
        "LOGIN_REQUIRED",
        "getTradeUrl 需要登录态(登录或导入 cookie,且会话含 steamid)",
      );
    }
    const accountId = steamId64ToAccountId(id64);
    const html = await this.transport.request<string>({
      host: "community",
      path: SteamEndpoints.community.tradeOfferNew(accountId),
      withCookies: true,
      noCache: true,
      rawText: true,
    });
    const match = /g_strTradeOfferAccessToken\s*=\s*"([^"]+)"/.exec(html);
    if (match === null) {
      throw new SteamError("FORBIDDEN", "无法从交易页解析 token(检查登录态)");
    }
    const token = match[1]!;
    return {
      url: `https://steamcommunity.com/tradeoffer/new/?partner=${accountId}&token=${token}`,
      token,
      partnerAccountId: accountId,
    };
  }

  #assertApiKey(): void {
    if (this.transport.apiKey === undefined) {
      throw new SteamError("CONFIGURATION", "交易接口需要 Steam Web API user key");
    }
  }
}
