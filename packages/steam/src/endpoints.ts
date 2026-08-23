/**
 * 端点常量 —— 三台主机的 host 与全部路径集中管理(booth 包同款做法)。
 * 主机可被客户端 baseUrls 覆盖(测试 / 代理 / 镜像),路径为权威定义。
 */

export const STEAM_HOSTS = {
  /** 官方 Steam Web API。 */
  api: "https://api.steampowered.com",
  /** 官方 Storefront API(无需 key)。 */
  store: "https://store.steampowered.com",
  /** 社区站点(登录态 / 库存 / 市场;国内网络需代理)。 */
  community: "https://steamcommunity.com",
  /** 登录服务(最终化登录 / 设备校验,拿 web cookie 用)。 */
  login: "https://login.steampowered.com",
} as const;

export type SteamHost = keyof typeof STEAM_HOSTS;

export const SteamEndpoints = {
  api: {
    /** 连通性探针,无需 key。 */
    serverInfo: "/ISteamWebAPIUtil/GetServerInfo/v1/",
    /** 动态枚举全部接口,需 key。 */
    supportedApiList: "/ISteamWebAPIUtil/GetSupportedAPIList/v1/",
    /** 应用全表(约 15 万条),需 key。 */
    appList: "/ISteamApps/GetAppList/v2/",
    /** 玩家资料摘要,需 key;steamids 逗号分隔(最多 100)。 */
    playerSummaries: "/ISteamUser/GetPlayerSummaries/v2/",
    /** vanity → steamid64,需 key。 */
    resolveVanityUrl: "/ISteamUser/ResolveVanityURL/v1/",
    /** 封禁信息,需 key。 */
    playerBans: "/ISteamUser/GetPlayerBans/v1/",
    /** 游戏库,需 key;2023.10 起受目标资料隐私限制。 */
    ownedGames: "/IPlayerService/GetOwnedGames/v1/",
    /** 家庭共享判断,需 key。 */
    isPlayingSharedGame: "/IPlayerService/IsPlayingSharedGame/v1/",
    /** 成就/统计定义,需 key。 */
    schemaForGame: "/ISteamUserStats/GetSchemaForGame/v2/",
    /** 玩家成就,需 key;资料非公开返回 success:false。 */
    playerAchievements: "/ISteamUserStats/GetPlayerAchievements/v1/",
    /** 玩家统计值,需 key。 */
    userStatsForGame: "/ISteamUserStats/GetUserStatsForGame/v2/",
    /** 全局成就解锁百分比,需 key;参数名为 gameid。 */
    globalAchievementPercentages: "/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",
    /** 全局统计聚合,需 key;数组参数 name[0]/count。 */
    globalStatsForGame: "/ISteamUserStats/GetGlobalStatsForGame/v1/",
    /** 当前在线人数,无需 key。 */
    numberOfCurrentPlayers: "/ISteamUserStats/GetNumberOfCurrentPlayers/v1/",
    /** 游戏新闻,无需 key。 */
    newsForApp: "/ISteamNews/GetNewsForApp/v2/",
    /** 好友列表,需 key;2023.10 起受目标资料隐私限制。 */
    friendList: "/ISteamUser/GetFriendList/v1/",
    /** 玩家群组,需 key。 */
    userGroupList: "/ISteamUser/GetUserGroupList/v1/",
    /** 玩家等级,需 key。 */
    steamLevel: "/IPlayerService/GetSteamLevel/v1/",
    /** 玩家徽章,需 key。 */
    badges: "/IPlayerService/GetBadges/v1/",
    /** 徽章任务进度,需 key。 */
    badgeProgress: "/IPlayerService/GetCommunityBadgeProgress/v1/",
    /** 近期玩过的游戏,需 key。 */
    recentlyPlayedGames: "/IPlayerService/GetRecentlyPlayedGames/v1/",
    /** 创意工坊物品详情,无需 key;POST form(itemcount + publishedfileids[0..])。 */
    publishedFileDetails: "/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
    /** 用户发布物列表,需 key。 */
    enumerateUserPublishedFiles: "/ISteamRemoteStorage/EnumerateUserPublishedFiles/v1/",
    /** 用户订阅物列表,需 key。 */
    enumerateUserSubscribedFiles: "/ISteamRemoteStorage/EnumerateUserSubscribedFiles/v1/",
    /** 物品定义,需 publisher key;无则抛 CONFIGURATION。 */
    itemDefs: "/ISteamInventory/GetItemDefs/v1/",
    /** 交易报价(发出+收到),需 key;需为带交易的账号开通 Web API 权限。 */
    tradeOffers: "/IEconService/GetTradeOffers/v1/",
    /** 单笔交易报价详情,需 key。 */
    tradeOffer: "/IEconService/GetTradeOffer/v1/",
    /** 交易历史,需 key。 */
    tradeHistory: "/IEconService/GetTradeHistory/v1/",
  },
  auth: {
    /** 密码 RSA 公钥,GET;仅 account_name 参数。 */
    rsaKey: "/IAuthenticationService/GetPasswordRSAPublicKey/v1/",
    /** 开始密码登录会话。 */
    beginCredentials: "/IAuthenticationService/BeginAuthSessionViaCredentials/v1/",
    /** 开始二维码登录会话。 */
    beginQr: "/IAuthenticationService/BeginAuthSessionViaQR/v1/",
    /** 提交 Steam Guard 验证码。 */
    updateGuardCode: "/IAuthenticationService/UpdateAuthSessionWithSteamGuardCode/v1/",
    /** 轮询登录状态。 */
    pollStatus: "/IAuthenticationService/PollAuthSessionStatus/v1/",
    /** 登录会话信息(二维码展示)。 */
    sessionInfo: "/IAuthenticationService/GetAuthSessionInfo/v1/",
    /** 用 refresh_token 换 access_token(可续期)。 */
    generateToken: "/IAuthenticationService/GenerateAccessTokenForApp/v1/",
  },
  login: {
    /** 最终化登录,返回 web cookie 传输列表。 */
    finalizeLogin: "/jwt/finalizelogin",
    /** 设备校验(邮箱 Guard 机器令牌)。 */
    checkDevice: "/jwt/checkdevice",
  },
  store: {
    /** 商店页详情,无需 key;appids 逗号分隔。 */
    appDetails: "/api/appdetails",
    /** 首页推荐,无需 key。 */
    featured: "/api/featured",
    /** 首页推荐分类,无需 key。 */
    featuredCategories: "/api/featuredcategories",
    /** 捆绑包详情,无需 key。 */
    packageDetails: "/api/packagedetails",
    /** DLC 列表,无需 key。 */
    dlcForApp: "/api/dlcforapp",
    /** 商店搜索,无需 key。 */
    storeSearch: "/api/storesearch",
    /** 分类内应用,无需 key。 */
    appsInCategory: "/api/getappsincategory",
    /** 类型内应用,无需 key。 */
    appsInGenre: "/api/getappsingenre",
    /** 促销页,无需 key;slug 参数。 */
    salePage: "/api/salepage",
    /** 商店评测,无需 key;appid 路径参数(json=1 返回 JSON)。 */
    appReviews: (appid: number): string => `/appreviews/${appid}`,
    /** 激活码兑换页(需登录 cookie;首次访问 302 + Set-Cookie 刷新会话)。 */
    registerKeyPage: "/account/registerkey",
    /** 激活码兑换提交(需登录 cookie + 页面 sessionID),返回 JSON。 */
    registerKeyAjax: "/account/ajaxregisterkey/",
  },
  community: {
    /** 玩家库存,公开可读;私有需登录 cookie。 */
    inventory: (steamid: string, appid: number, contextId: string): string =>
      `/inventory/${steamid}/${appid}/${contextId}`,
    /** 单件即时价,无需登录。 */
    marketPriceOverview: "/market/priceoverview/",
    /** 市场搜索,无需登录。 */
    marketSearch: "/market/search/render",
    /** 愿望单(公开读),返回 appid → 条目 的 JSON 对象。 */
    wishlist: (steamid: string): string => `/wishlist/profiles/${steamid}/wishlistdata`,
    /** 买卖挂单深度(订单簿),POST form(appid + market_hash_name);登录态更稳。 */
    itemOrdersHistogram: "/market/itemordershistogram",
    /** 历史价格曲线,GET;登录态更稳。 */
    priceHistory: "/market/pricehistory/",
    /** 我的挂单,需登录 cookie;norender=1 返回 JSON。 */
    myListings: "/market/mylistings/",
    /** 我的成交历史,需登录 cookie;norender=1 返回 JSON。 */
    myHistory: "/market/myhistory/",
    /** 交易报价页(解析 g_strTradeOfferAccessToken 得交易链接),需登录 cookie。 */
    tradeOfferNew: (partnerAccountId: number): string => `/tradeoffer/new/?partner=${partnerAccountId}`,
    /** 玩家资料 XML(含 recentActivity 动态流),公开读。 */
    profileXml: (steamid: string): string => `/profiles/${steamid}/?xml=1`,
    /** 评论渲染(公开读;norender=1 返回 comments JSON)。 */
    commentRender: (feature: string, id: string): string => `/comment/${feature}/render/${id}/`,
  },
} as const;
