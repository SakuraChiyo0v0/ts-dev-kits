/**
 * SteamClient 门面 —— 统一入口。领域能力以 client.user / library / stats / news /
 * store / inventory / market / workshop 提供;登录态 P2 由 client.auth 提供。
 */
import { AuthStore } from "@sakurachiyo0v0/account";
import { SteamHttpTransport } from "./http.js";
import { SteamError } from "./errors.js";
import { SteamEndpoints } from "./endpoints.js";
import type { ServerInfo, SteamClientOptions } from "./types.js";
import { UserApi } from "./api/user.js";
import { LibraryApi } from "./api/library.js";
import { StatsApi } from "./api/stats.js";
import { NewsApi } from "./api/news.js";
import { StoreApi } from "./api/store.js";
import { InventoryApi } from "./api/inventory.js";
import { MarketApi } from "./api/market.js";
import { WorkshopApi } from "./api/workshop.js";
import { TradeApi } from "./api/trade.js";
import { RedeemApi } from "./api/redeem.js";
import { AuthApi } from "./auth/auth-api.js";

export interface SteamClient {
  /** 是否配置了 Web API user key。 */
  readonly hasApiKey: boolean;
  /** 是否配置了发行商密钥。 */
  readonly hasPublisherKey: boolean;
  /** 是否持有会话 cookie(登录态后为 true)。 */
  readonly hasSession: boolean;
  /** 登录态管理(密码+Guard / QR / cookie 导入 / 续期 / 登出)。 */
  readonly auth: AuthApi;
  /** 玩家资料 / 好友 / 等级 / 徽章 / 群组 / 封禁 / 动态流 / 评论。 */
  readonly user: UserApi;
  /** 游戏库 / 近期游戏 / 愿望单。 */
  readonly library: LibraryApi;
  /** 成就与统计。 */
  readonly stats: StatsApi;
  /** 游戏新闻。 */
  readonly news: NewsApi;
  /** 商店信息(无需 key)。 */
  readonly store: StoreApi;
  /** 玩家库存(community)+ 物品定义(publisher key)。 */
  readonly inventory: InventoryApi;
  /** 市场价格与搜索 / 订单簿 / 价格历史 / 我的挂单与成交(只读)。 */
  readonly market: MarketApi;
  /** 创意工坊。 */
  readonly workshop: WorkshopApi;
  /** 交易报价与历史(只读)。 */
  readonly trade: TradeApi;
  /** 激活码兑换(写操作;全 SDK 唯一写能力,需登录态)。 */
  readonly redeem: RedeemApi;
  /** 连通性探针(ISteamWebAPIUtil/GetServerInfo,无需 key)。 */
  probe(): Promise<ServerInfo>;
  /** 动态枚举全部 Steam Web API 接口(需 key)。 */
  getSupportedApiList(): Promise<unknown>;
  /** 关闭传输层。 */
  close(): Promise<void>;
}

/** 创建 Steam 客户端。 */
export function createSteamClient(options: SteamClientOptions = {}): SteamClient {
  const transport = new SteamHttpTransport({
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
    ...(options.publisherKey !== undefined ? { publisherKey: options.publisherKey } : {}),
    ...(options.proxy !== undefined ? { proxy: options.proxy } : {}),
    ...(options.baseUrls !== undefined ? { baseUrls: options.baseUrls } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
    ...(options.cache !== undefined ? { cache: options.cache } : {}),
    ...(options.cookie !== undefined ? { cookie: options.cookie } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
  });

  const user = new UserApi(transport);
  const library = new LibraryApi(transport, user);
  const stats = new StatsApi(transport);
  const news = new NewsApi(transport);
  const store = new StoreApi(transport);
  const market = new MarketApi(transport);
  const workshop = new WorkshopApi(transport);
  const auth = new AuthApi(transport, {
    ...(options.sessionPath !== undefined
      ? { store: new AuthStore({ platform: "steam", path: options.sessionPath }) }
      : { store: new AuthStore({ platform: "steam" }) }),
  });
  // 登录会话的 steamid 提供者(getOwnInventory / getTradeUrl 需要)。
  const ownSteamId = (): string | undefined => auth.status().steamid;
  const inventory = new InventoryApi(transport, ownSteamId);
  const trade = new TradeApi(transport, ownSteamId);
  const redeem = new RedeemApi(transport);

  const client: SteamClient = {
    get hasApiKey() {
      return transport.apiKey !== undefined;
    },
    get hasPublisherKey() {
      return transport.publisherKey !== undefined;
    },
    get hasSession() {
      return auth.status().loggedIn;
    },
    auth,
    user,
    library,
    stats,
    news,
    store,
    inventory,
    market,
    workshop,
    trade,
    redeem,
    async probe() {
      // GetServerInfo/v1 真实响应为顶层 { servertime, servertimestring },无 response 包装。
      const result = await transport.request<ServerInfo>({
        host: "api",
        path: SteamEndpoints.api.serverInfo,
      });
      return result;
    },
    async getSupportedApiList() {
      if (transport.apiKey === undefined && transport.publisherKey === undefined) {
        throw new SteamError("CONFIGURATION", "GetSupportedAPIList 需要 Steam Web API key");
      }
      const result = await transport.request<{ apilist: unknown }>({
        host: "api",
        path: SteamEndpoints.api.supportedApiList,
        withKey: true,
      });
      return result.apilist;
    },
    async close() {
      await transport.close();
    },
  };

  return client;
}
