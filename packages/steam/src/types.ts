/**
 * 核心类型与配置 —— 字段语义的权威定义。
 * 领域类型字段名与 Steam 平台返回保持一致(snake_case / PascalCase 均为原始字段),
 * 便于对照官方文档与调试;需要本地化的语义(如 privacyRestricted)另行标注。
 */
import type { SteamHost } from "./endpoints.js";

/** 客户端创建选项。 */
export interface SteamClientOptions {
  /** Steam Web API user key(可选;不传则公开无 key 方法可用,需要 key 的方法抛 CONFIGURATION)。 */
  apiKey?: string;
  /** 发行商密钥(可选;无则 GetItemDefs 等 publisher 方法抛 CONFIGURATION)。 */
  publisherKey?: string;
  /** 代理,http(s):// 或 socks5://(community 主机国内不可达,建议配置)。 */
  proxy?: string;
  /** 覆盖三台主机的 base URL(测试 / 镜像用)。 */
  baseUrls?: Partial<Record<SteamHost, string>>;
  /** AuthStore 路径(P2 登录态使用),默认 <配置根>/amechan/steam/auth.json。 */
  sessionPath?: string;
  /** 可注入 fetch 实现(默认 undici fetch)。 */
  fetchImpl?: typeof fetch;
  /** 单请求超时(毫秒),默认 15000。 */
  timeoutMs?: number;
  /** 429 最大重试次数,默认 2。 */
  maxRetries?: number;
  /** User-Agent,默认 sakurachiyo0v0-ts-dev-kits/<version>。 */
  userAgent?: string;
  /** 响应缓存配置。 */
  cache?: CacheOptions;
  /** 会话 cookie 串(P2 登录态注入;也可显式传入)。 */
  cookie?: string;
  /** 脱敏请求日志(仅输出 method / host / path / status,不含 query 与凭据)。 */
  logger?: (line: string) => void;
}

/** TTL 响应缓存配置。 */
export interface CacheOptions {
  /** 是否启用,默认 true(仅 GET 且无 json body 的方法命中)。 */
  enabled?: boolean;
  /** 缓存 TTL 毫秒,默认 60000。 */
  ttlMs?: number;
}

/** GetServerInfo 探针返回。 */
export interface ServerInfo {
  servertime: number;
  servertimestring: string;
}

/** 接受任意 Steam ID 形态(steamID64 / steamID3 / steamID2 / vanity / 资料页 URL)。 */
export type SteamIdInput = string | number;

// ---------------------------------------------------------------------------
// user 域
// ---------------------------------------------------------------------------

/** GetPlayerSummaries/v2 单个玩家摘要(原始字段)。 */
export interface PlayerSummary {
  steamid: string;
  communityvisibilitystate: number;
  profilestate?: number;
  personaname: string;
  profileurl: string;
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
  avatarhash?: string;
  lastlogoff?: number;
  personastate: number;
  primaryclanid?: string;
  timecreated?: number;
  personastateflags?: number;
  loccountrycode?: string;
  locstatecode?: string;
  loccityid?: number;
  gameid?: string;
  gameextrainfo?: string;
}

/** GetPlayerBans/v1 单个玩家封禁信息(Steam 原始 PascalCase 字段)。 */
export interface PlayerBan {
  SteamId: string;
  CommunityBanned: boolean;
  VACBanned: boolean;
  NumberOfVACBans: number;
  DaysSinceLastBan: number;
  NumberOfGameBans: number;
  EconomyBan: string;
}

// ---------------------------------------------------------------------------
// library 域
// ---------------------------------------------------------------------------

/** GetOwnedGames/v1 单个游戏(原始字段,需 include_appinfo 才有名称/图标)。 */
export interface OwnedGame {
  appid: number;
  name?: string;
  playtime_forever: number;
  playtime_2weeks?: number;
  playtime_windows_forever?: number;
  playtime_mac_forever?: number;
  playtime_linux_forever?: number;
  img_icon_url?: string;
  img_logo_url?: string;
  has_community_visible_stats?: boolean;
}

/** GetOwnedGames/v1 结果;privacyRestricted=true 表示目标资料未公开导致结果不完整。 */
export interface OwnedGamesResult {
  gameCount: number;
  games: OwnedGame[];
  /** 目标资料非公开(仅当返回为空时的启发式标记,非错误)。 */
  privacyRestricted: boolean;
}

// ---------------------------------------------------------------------------
// stats 域
// ---------------------------------------------------------------------------

/** GetSchemaForGame/v2 成就定义。 */
export interface SchemaAchievement {
  name: string;
  defaultvalue: number;
  displayName: string;
  hidden: number;
  description: string;
  icon: string;
  icongray: string;
}

/** GetSchemaForGame/v2 统计定义。 */
export interface SchemaStat {
  name: string;
  defaultvalue: number;
  displayName: string;
}

/** GetSchemaForGame/v2 结果。 */
export interface GameSchema {
  gameName: string;
  gameVersion: string;
  achievements: SchemaAchievement[];
  stats: SchemaStat[];
}

/** GetPlayerAchievements/v1 / GetUserStatsForGame/v2 单个成就(原始字段)。 */
export interface PlayerAchievement {
  apiname: string;
  achieved: number;
  unlocktime?: number;
  name?: string;
  description?: string;
}

/** GetUserStatsForGame/v2 单个统计值(原始字段)。 */
export interface GameStatValue {
  name: string;
  value: number;
}

/** GetPlayerAchievements/v1 结果;privacyRestricted=true 表示资料非公开(success:false)。 */
export interface PlayerAchievementsResult {
  steamId?: string;
  gameName?: string;
  achievements: PlayerAchievement[];
  privacyRestricted: boolean;
}

/** GetUserStatsForGame/v2 结果。 */
export interface UserStatsResult {
  steamId: string;
  gameName: string;
  achievements: PlayerAchievement[];
  stats: GameStatValue[];
}

/** GetGlobalAchievementPercentagesForApp/v2 单条百分比。 */
export interface AchievementPercentage {
  name: string;
  percent: number;
}

// ---------------------------------------------------------------------------
// news 域
// ---------------------------------------------------------------------------

/** GetNewsForApp/v2 单条新闻(原始字段)。 */
export interface NewsItem {
  gid: string;
  title: string;
  url: string;
  is_external_url: boolean;
  author: string;
  contents: string;
  feedlabel: string;
  date: number;
  feedname: string;
  appid: number;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// store 域
// ---------------------------------------------------------------------------

/** appdetails 单项结果(success:false 表示无此 app 或隐藏)。 */
export interface AppDetailsResult {
  success: boolean;
  data?: Record<string, unknown>;
}

/** GetAppList/v2 单条应用。 */
export interface AppListEntry {
  appid: number;
  name: string;
}

/** storesearch 单条结果(原始字段)。 */
export interface StoreSearchItem {
  type: string;
  name: string;
  id: number;
  tiny_image?: string;
  price?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// inventory 域(community)
// ---------------------------------------------------------------------------

/** 库存资产(原始字段)。 */
export interface InventoryAsset {
  appid: number;
  contextid: string;
  assetid: string;
  classid: string;
  instanceid: string;
  amount: string;
}

/** 库存物品描述(原始字段;tags 为稀有度/类型等)。 */
export interface InventoryDescription {
  appid: number;
  classid: string;
  instanceid: string;
  currency?: number;
  background_color?: string;
  icon_url?: string;
  icon_url_large?: string;
  descriptions?: Array<{ value: string; color?: string }>;
  tradable?: number;
  name: string;
  name_color?: string;
  type: string;
  market_name: string;
  market_hash_name: string;
  commodity?: number;
  marketable?: number;
  market_tradable_restriction?: number;
  market_marketable_restriction?: number;
  tags?: Array<{
    category: string;
    internal_name: string;
    localized_category_name: string;
    localized_tag_name: string;
    color?: string;
  }>;
}

/** GET /inventory/:steamid/:appid/:contextid 响应(原始字段)。 */
export interface InventoryResponse {
  assets: InventoryAsset[];
  descriptions: InventoryDescription[];
  more_items?: number;
  last_assetid?: string;
  total_inventory_count?: number;
  success: number;
  rwgrsn?: number;
}

// ---------------------------------------------------------------------------
// market 域(community)
// ---------------------------------------------------------------------------

/** priceoverview 响应(原始字段);success:false 表示无该物品数据。 */
export interface MarketPriceOverview {
  success: boolean;
  lowest_price?: string;
  volume?: string;
  median_price?: string;
}

/** search/render 单条结果(原始字段)。 */
export interface MarketSearchItem {
  name: string;
  hash_name: string;
  sell_listings: number;
  sell_price: number;
  sell_price_text: string;
  app_icon?: string;
  app_name?: string;
  sale_price_text?: string;
}

/** search/render 响应(原始字段)。 */
export interface MarketSearchResponse {
  success: boolean;
  start: number;
  pagesize: number;
  total_count: number;
  results: MarketSearchItem[];
}

/** GetFriendList/v1 单个好友(原始字段)。 */
export interface Friend {
  steamid: string;
  relationship: string;
  friends_since: number;
}

/** GetFriendList/v1 结果;privacyRestricted=true 表示目标资料未公开导致结果不完整。 */
export interface FriendListResult {
  friends: Friend[];
  privacyRestricted: boolean;
}

/** GetUserGroupList/v1 单个群组(gid 为群组 steamID64)。 */
export interface UserGroup {
  gid: string;
}

/** GetUserGroupList/v1 结果。 */
export interface UserGroupListResult {
  groups: UserGroup[];
}

/** GetBadges/v1 单个徽章(原始字段)。 */
export interface BadgeEntry {
  badgeid: number;
  level: number;
  completion_time: number;
  xp: number;
  scarcity: number;
  appid?: number;
  communityitemid?: number;
  border_color?: number;
}

/** GetBadges/v1 结果。 */
export interface BadgesResult {
  badges: BadgeEntry[];
  playerXp: number;
  playerLevel: number;
  playerXpNeededToCurrentLevel: number;
  playerXpNeededToNextLevel: number;
}

/** GetCommunityBadgeProgress/v1 单个任务(原始字段)。 */
export interface BadgeQuest {
  questid: number;
  completed: boolean;
}

/** GetCommunityBadgeProgress/v1 结果。 */
export interface CommunityBadgeProgress {
  badgeid: number;
  quests: BadgeQuest[];
}

/** GetRecentlyPlayedGames/v1 单个游戏(原始字段)。 */
export interface RecentlyPlayedGame {
  appid: number;
  name?: string;
  playtime_2weeks?: number;
  playtime_forever: number;
  img_icon_url?: string;
}

/** GetRecentlyPlayedGames/v1 结果。 */
export interface RecentlyPlayedResult {
  totalCount: number;
  games: RecentlyPlayedGame[];
}

/** 愿望单条目(community wishlistdata,字段以实际返回为准,宽松类型)。 */
export interface WishlistEntry {
  name?: string;
  capsule?: string;
  review_score?: number;
  reviews_total?: number;
  type?: string;
}

/** 愿望单结果;privacyRestricted=true 表示目标愿望单未公开。 */
export interface WishlistResult {
  /** appid → 条目。 */
  entries: Record<string, WishlistEntry>;
  privacyRestricted: boolean;
}

/** GetPublishedFileDetails/v1 单件物品详情(原始字段)。 */
export interface WorkshopItem {
  publishedfileid: string;
  creator?: string;
  creator_appid?: number;
  consumer_appid?: number;
  filename?: string;
  file_size?: number;
  file_url?: string;
  preview_url?: string;
  title?: string;
  description?: string;
  time_created?: number;
  time_updated?: number;
  visibility?: number;
}

/** EnumerateUser(P|S)ublishedFiles 单条文件摘要(原始字段)。 */
export interface WorkshopFileSummary {
  publishedfileid: string;
  filename?: string;
  file_size?: number;
  file_url?: string;
  time_created?: number;
  time_updated?: number;
}

/** EnumerateUserPublishedFiles / EnumerateUserSubscribedFiles 结果。 */
export interface EnumerateFilesResult {
  total: number;
  files: WorkshopFileSummary[];
}

// ---------------------------------------------------------------------------
// market P3(订单簿 / 价格历史 / 我的挂单与成交)
// ---------------------------------------------------------------------------

/** itemordershistogram 挂单深度图条目(价格, 数量)。 */
export type OrderGraphPoint = [price: number, quantity: number];

/** itemordershistogram 响应(原始字段)。 */
export interface OrderHistogramResult {
  success: boolean;
  sell_order_graph: OrderGraphPoint[];
  sell_order_summary?: string;
  buy_order_graph: OrderGraphPoint[];
  buy_order_summary?: string;
  highest_buy_order?: number;
  lowest_sell_order?: number;
  buy_order_count?: number;
  sell_order_count?: number;
}

/** pricehistory 单点(时间戳秒, 价格, 当日成交量)。 */
export type PriceHistoryPoint = [timestamp: number, price: number, volume: number];

/** pricehistory 响应。 */
export interface PriceHistoryResult {
  success: boolean;
  /** 价格曲线(升序)。 */
  prices: PriceHistoryPoint[];
}

/** mylistings 单条挂单(原始字段)。 */
export interface MarketListing {
  listingid: string;
  appid: number;
  market_hash_name: string;
  asset?: {
    currency?: number;
    appid: number;
    contextid: string;
    id: string;
    amount: string;
    market_fee_app?: number;
    market_fee?: number;
    market_actions?: unknown[];
    tags?: unknown[];
  };
  price: number;
  original_price?: number;
  fee?: number;
  currencyid?: number;
  time_created?: number;
  time_finish_hold?: number;
  steam_fee?: number;
  publisher_fee?: number;
}

/** mylistings 响应。 */
export interface MyListingsResult {
  success: boolean;
  total_count: number;
  listings: MarketListing[];
}

/** myhistory 单条成交事件(原始字段)。 */
export interface MarketHistoryEvent {
  event_type: "purchase" | "sale" | "buy_order" | "sell_order" | "cancel" | string;
  time_event: number;
  listingid?: string;
  asset?: {
    currency?: number;
    appid: number;
    contextid: string;
    id: string;
    amount: string;
    market_hash_name?: string;
    name?: string;
  };
  price?: number;
  currencyid?: number;
  purchase_price?: number;
  sale_price?: number;
  status?: string;
  steam_fee?: number;
  publisher_fee?: number;
  total_price?: number;
}

/** myhistory 响应。 */
export interface MyHistoryResult {
  success: boolean;
  total_count: number;
  events: MarketHistoryEvent[];
}

// ---------------------------------------------------------------------------
// trade 域(只读,IEconService + 交易链接解析)
// ---------------------------------------------------------------------------

/** GetTradeOffers/GetTradeOffer 单个资产(原始字段)。 */
export interface TradeAsset {
  appid: number;
  contextid: string;
  assetid: string;
  amount: string;
  classid?: string;
  instanceid?: string;
  new_assetid?: string;
  new_contextid?: string;
  missing?: boolean;
  est_usd?: string;
  market_hash_name?: string;
  market_name?: string;
}

/** GetTradeOffers 单个报价(原始字段)。 */
export interface TradeOffer {
  tradeofferid: string;
  accountid_other: number;
  message: string;
  expiration_time: number;
  trade_offer_state: number;
  items_to_give?: TradeAsset[];
  items_to_receive?: TradeAsset[];
  is_our_offer: boolean;
  time_created: number;
  time_updated: number;
  from_real_time_trade: boolean;
  escrow_end_date?: number;
  confirmed?: boolean;
  to_steamid?: string;
  from_steamid?: string;
}

/** GetTradeOffers 结果。 */
export interface TradeOffersResult {
  tradeOffersSent: TradeOffer[];
  tradeOffersReceived: TradeOffer[];
  descriptions?: Record<string, unknown>;
}

/** GetTradeOffer 结果。 */
export interface TradeOfferResult {
  offer?: TradeOffer;
}

/** GetTradeHistory 单笔交易(原始字段)。 */
export interface TradeHistoryEntry {
  tradeid: string;
  steamid_other: string;
  time_init: number;
  time_escrow_end?: number;
  status: number;
  assets_given?: TradeAsset[];
  assets_received?: TradeAsset[];
  steamid_other_steam3?: string;
}

/** GetTradeHistory 结果。 */
export interface TradeHistoryResult {
  trades: TradeHistoryEntry[];
  more: boolean;
}

/** 交易链接解析结果(community /tradeoffer/new/ HTML 中的 token)。 */
export interface TradeUrlResult {
  url: string;
  token: string;
  partnerAccountId: number;
}

// ---------------------------------------------------------------------------
// user P3(动态流 / 评论读,community)
// ---------------------------------------------------------------------------

/** 资料 XML recentActivity 单条动态(原始字段)。 */
export interface ProfileActivity {
  /** 事件类型数字(如 0=新徽章, 12=玩新游戏, 53=解锁成就)。 */
  eventType?: string;
  gameID?: string;
  webLink?: string;
  steamLink?: string;
  unixTime?: string;
  /** XML 原始文本(未解析),含事件描述。 */
  raw?: string;
}

/** 动态流结果;空数组表示资料无公开动态。 */
export interface ActivityFeedResult {
  steamid: string;
  activities: ProfileActivity[];
}

/** comment render 单条评论(原始字段,宽松类型)。 */
export interface ProfileComment {
  commentid?: string;
  author?: {
    steamid?: string;
    personaname?: string;
    avatar?: string;
  };
  timestamp?: number;
  text?: string;
}

/** 评论读结果。 */
export interface CommentsResult {
  totalCount: number;
  comments: ProfileComment[];
}

// ---------------------------------------------------------------------------
// inventory P3(物品定义 / 自己库存)
// ---------------------------------------------------------------------------

/** GetItemDefs/v1 单条物品定义(原始字段;publisher key)。 */
export interface ItemDef {
  appid: number;
  itemdefid: number;
  name?: string;
  name_localized?: string;
  type?: string;
  icon_url?: string;
  icon_url_large?: string;
  market_name?: string;
  market_hash_name?: string;
  tradable?: boolean;
  marketable?: boolean;
  price_category?: string;
  tags?: string;
}

/** GetItemDefs/v1 结果。 */
export interface ItemDefsResult {
  items: ItemDef[];
}

/** 商店评测(appreviews,公开;filter 可用 recent/updated/all)。 */
export interface AppReviewAuthor {
  steamid: string;
  num_games_owned: number;
  num_reviews: number;
  playtime_forever: number;
  playtime_at_review: number;
  last_played: number;
}

export interface AppReview {
  recommendationid: string;
  author: AppReviewAuthor;
  language: string;
  review: string;
  timestamp_created: number;
  timestamp_updated: number;
  voted_up: boolean;
  votes_up: number;
  votes_funny: number;
  weighted_vote_score: number;
  comment_count: number;
  steam_purchase: boolean;
  received_for_free: boolean;
  written_during_early_access: boolean;
}

export interface AppReviewsResult {
  success: number;
  query_summary: {
    num_reviews: number;
    review_score: number;
    review_score_desc: string;
    total_positive: number;
    total_negative: number;
    total_reviews: number;
  };
  reviews: AppReview[];
  cursor: string;
}

/** 激活码兑换结果(ePurchaseResult 码映射见 redeem.ts)。 */
export interface RedeemResult {
  /** 是否成功兑换。 */
  success: boolean;
  /** 结果码(ePurchaseResult;0/1 为成功语义)。 */
  result: number;
  /** 人话描述(失败时含原因)。 */
  message: string;
  /** 成功时兑换到的游戏/内容名(从 receipt line_items 提取)。 */
  games?: string[];
}
