# Steam 接口调研报告

> 调研日期:2026-08-23
> 目的:为 `@sakurachiyo0v0/steam` SDK 的前期设计提供事实基础(接口清单、认证分级、限流、网络可达性、参考实现)。
> 原始抓取材料在调研机 `%TEMP%\steam-research\`(官方文档页、Revadike wiki、各 npm README、实测 JSON),过期可重抓。

## 0. 结论速览

Steam 没有面向"社区/商店/市场"场景的单一官方 SDK,接口实际分**四层**,认证要求从"完全公开"到"发行商密钥"逐级递增:

| 层 | 主机 | 认证 | 典型用途 |
| --- | --- | --- | --- |
| ① 官方 Steam Web API | `api.steampowered.com` | 公开 / User key / Publisher key | 玩家资料、游戏库、成就、新闻、库存(官方)、发行商数据 |
| ② 官方 Storefront API | `store.steampowered.com/api/` | **无 key** | 商店页数据(价格/描述/评测/搜索) |
| ③ 社区内部 API(非官方文档) | `steamcommunity.com` | 公开 / 登录 cookie | 库存、市场(价格/买卖)、交易报价、好友、资料页 |
| ④ Steamworks SDK / 协议层 | 客户端协议 / C++ SDK | 会话票据 | 游戏内功能;node 生态用 `steam-user` 模拟客户端 |

**本机实测(2026-08-23)**:`api.steampowered.com` ✅ 可达(无 key 调通 `ISteamWebAPIUtil/GetServerInfo`)、`store.steampowered.com` ✅ 可达(取到 TF2 简中商店数据),但 `steamcommunity.com` ❌ **连接超时(国内网络无代理不可达)**。对 SDK 是硬约束:库存/市场/登录能力必须支持自定义 host 或代理。

## 1. 官方 Steam Web API(`api.steampowered.com`)

官方文档:[Web API Overview](https://partner.steamgames.com/doc/webapi_overview)、[Authentication using Web API Keys](https://partner.steamgames.com/doc/webapi_overview/auth);接口镜像(好查):[steamapi.xpaw.me](https://steamapi.xpaw.me/)、[TF2 wiki WebAPI](https://wiki.teamfortress.com/wiki/WebAPI)。

### 1.1 请求格式

```
https://api.steampowered.com/<interface>/<method>/v<version>/?key=...&format=json&<params>
```

- 版本后缀 `/v1/` `/v2/`;`format` 支持 `json`(默认)/`xml`/`vdf`;数组参数用 `count` + `name[0]=...&name[1]=...`。
- **Service 接口**(接口名以 `Service` 结尾,如 `IPlayerService`)额外支持把全部参数塞进 `input_json` 一个 JSON blob(URL 编码),`key`/`format` 仍单独传。
- key 可放 query 参数,也可放请求头 `X-WebAPI-Key`。
- 发行商专用高可用主机:`https://partner.steam-api.com`(仅 HTTPS,**每个请求都必须带 publisher key**)。

### 1.2 认证分级(官方文档要点)

- **无 key**:部分公开方法(`GetAppList`、`GetNewsForApp`、`GetNumberOfCurrentPlayers`、`GetServerInfo`)。
- **User key(用户密钥)**:人人可申请,[steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey),需绑定一个域名并同意 ToS;覆盖绝大多数玩家数据接口。⚠️ 申请页在 steamcommunity.com 上(国内需代理)。
- **Publisher key(发行商密钥)**:Steamworks 合作方账号管理员创建,按"发行商组 + 权限组 + IP 白名单"控制。四类权限:**Microtransactions**(内购)、**Sales Data**(IPartnerFinancialsService)、**Economy**(库存服务)、**General**(鉴权/所有权校验)。**必须存于安全服务端,不得随客户端分发**。
- 官方近年收紧:`ISteamUserAuth/AuthenticateUserTicket` 现**要求 publisher key**,只能从安全服务端调用。

### 1.3 完整接口清单(从官方 overview 页提取,31 个)

| 接口 | 重点方法 | 认证/用途 |
| --- | --- | --- |
| `ISteamApps` | `GetAppList/v2`(约 15 万应用)、`GetServersAtAddress`、`UpToDateCheck` | 公开 |
| `ISteamUser` | `GetPlayerSummaries/v2`、`GetFriendList`、`GetPlayerBans`、`ResolveVanityURL`、`GetUserGroupList`、`GetUserStatsForGame` | user key |
| `ISteamUserStats` | `GetSchemaForGame`、`GetPlayerAchievements`、`GetGlobalAchievementPercentagesForApp`、`GetGlobalStatsForGame`、`GetNumberOfCurrentPlayers` | 公开/低敏 |
| `ISteamNews` | `GetNewsForApp/v2` | 公开,官方文档示例接口 |
| `ISteamWebAPIUtil` | `GetServerInfo`(无需 key,连通性探针)、`GetSupportedAPIList`(动态枚举全部接口) | 公开 |
| `IPlayerService` | `GetOwnedGames`、`GetRecentlyPlayedGames`、`GetSteamLevel`、`GetBadges`、`GetCommunityBadgeProgress`、`IsPlayingSharedGame` | user key,**2023.10 起受隐私收紧影响** |
| `ISteamRemoteStorage` | `GetPublishedFileDetails`(无 key 可调)、`GetUGCFileDetails`、`EnumerateUserPublishedFiles`、`EnumerateUserSubscribedFiles` | UGC/创意工坊 |
| `ISteamUserAuth` | `AuthenticateUserTicket/v1` | **publisher key** |
| `IInventoryService` | `GetItemDefs`、`GetInventory` | publisher key(Economy) |
| `IEconService` / `IEconItems_<appid>` / `ISteamEconomy` | `GetTradeOffers`、`GetTradeHistory`、`GetSchema`、`GetPlayerItems` | publisher key / 兼容旧方案 |
| `IEconMarketService` | 市场相关 | publisher key |
| `IGameServersService` | 游戏服务器账号 | publisher key |
| `ICheatReportingService` | VAC 举报 | publisher key |
| `IPartnerFinancialsService` | 销售数据 | publisher key(Sales Data) |
| `ISteamMicroTxn` / `ISteamMicroTxnSandbox` | 内购初始化/确认 | publisher key |
| `IPublishedFileService` / `ISteamPublishedItemSearch` / `ISteamPublishedItemVoting` / `IWorkshopService` | 创意工坊管理/搜索/投票 | publisher key |
| `IBroadcastService` / `IGameNotificationsService` / `ILobbyMatchmakingService` / `IStoreService` / `ISteamCommunity` / `ISteamGameServerStats` / `ISteamLeaderboards` / `ISiteLicenseService` / `ICloudService` | 直播/通知/大厅/商店/社区/服务器统计/排行榜 | 视方法而定 |

### 1.4 关键变动与坑(2023–2025)

1. **隐私收紧(2023.10)**:`GetOwnedGames` / `GetRecentlyPlayedGames` / `GetFriendList` 等只返回**目标资料为公开**的数据,否则为空([社区讨论](https://steamcommunity.com/discussions/forum/1/4333105935814636670/))。SDK 必须区分"隐私导致空结果"与"真错误"。
2. **AuthenticateUserTicket 变更**:官方现文档明确要求 publisher key + 安全服务端调用(游戏服务器走 `api.steampowered.com` 的 user key 路径但限流)。
3. **动态限流(2025.5 社区实测)**:社区/交易类端点出现随时间变化的动态 429,`getUserDetails` 等被持续限流,代理 IP 反被更严封禁([讨论帖](https://dev.doctormckay.com/topic/5692-http-error-429-rate-limits/)、[429 说明](https://api.steamwebapi.com/blog/429-too-many-requests-for-getplayersummaries))。Web API 主 key 业界普遍记录约 **10 万次/天**(官方未文档化,以 429 为准)。
4. **旧库存 JSON 端点已下线**:`/profiles/:steamid/inventory/json/:appid/:contextid` 不可用,统一走新 `/inventory/` 端点([SO 修订记录](https://stackoverflow.com/posts/17679641/revisions))。

## 2. Storefront API(无需 key)

端点清单见 [Revadike/InternalSteamWebAPI wiki](https://github.com/Revadike/InternalSteamWebAPI/wiki) 与 [apis.io Steam Storefront](https://apis.io/apis/steam/steam-storefront-api/)。

- `appdetails?appids=440&l=schinese&cc=cn` — **本机实测通过**;返回成功、描述(HTML)、价格、DLC、评测分数、截图等;**`l`/`cc` 参数做本地化,中文场景必须用**。
- `featured` / `featuredcategories` — 首页推荐(实测通过)。
- 其他:`appuserdetails`、`packagedetails`、`dlcforapp`、`getappsincategory`、`getappsingenre`、`storesearch`、`salepage`、`appreviews`、`apphoverpublic`、`libraryappdetails`。
- **限流:约 300 次/5 分钟**(Revadike 记录),必须缓存 + 退避。

## 3. 社区 API(`steamcommunity.com`,非官方但事实标准)

### 3.1 登录与认证(四种形态)

1. **OpenID 2.0**(`steamcommunity.com/openid/login`):第三方网站"验证用户 Steam 身份",返回 `claimed_id` 中含 64 位 steamid,**只验身份不拿数据**;npm 封装 [steam-signin](https://www.npmjs.com/package/steam-signin)。
2. **新版登录流程(做"登录态"推荐)**:Steam 客户端/移动端协议 `LoginSession`(用户名密码 + Steam Guard,或 **QR 扫码**,或 TOTP),成功拿 `accessToken` + `refreshToken`,再 `getWebCookies()` 换 `steamLoginSecure` / `sessionid` / `steamLogin` cookie 用于社区请求。参考实现 [DoctorMcKay/node-steam-session](https://github.com/DoctorMcKay/node-steam-session),配套 [steam-totp](https://www.npmjs.com/package/steam-totp) 生成 2FA 码。
3. **老式密码 + RSA + Steam Guard**(`POST /login/dologin`):已被新流程取代,不建议新做。
4. **浏览器 Cookie 导入**:用户手动登录后导出 cookie(SDK 可用 `@sakurachiyo0v0/account` 的 `AuthStore` 持久化,同 booth 包)。

### 3.2 玩家资料

- Web API:`GetPlayerSummaries/v2`(头像/昵称/在线状态/最近游戏)。
- 网页直取:`/profiles/<steamid>/?xml=1`(XML 摘要)、`/id/<vanity>/?xml=1`(vanity 解析)、`/miniprofile/<accountid>/json`。资料私密时受限。
- Steam ID 转换:steamID2 `STEAM_X:Y:Z` → `accountID = Z*2+Y` → `steamID64 = 76561197960265728 + accountID`;steamID3 `[U:1:Z]` 同理;vanity 解析用 `ISteamUser/ResolveVanityURL`(需 key)。参考 [JohnPeel/steamid](https://github.com/JohnPeel/steamid)。

### 3.3 库存(新端点,公开可读)

```
GET /inventory/:steamid/:appid/:contextid?l=english&count=75&start_assetid=<翻页游标>
```

返回 `assets[]`(assetid/classid/instanceid)+ `descriptions[]`(名称/图标/稀有度 tags/可交易标记/市场哈希名),`more_items` + `last_assetid` 翻页([文档](https://github.com/Revadike/InternalSteamWebAPI/wiki/Get-Inventory))。**私有库存需登录 cookie**。contextid 与 appid 绑定(CS2/730 → 2,TF2/440 → 2,Steam 背包 753/6)。

### 3.4 市场

| 端点 | 说明 | 限流(Revadike 记录) |
| --- | --- | --- |
| `/market/search/render?norender=1&appid=...&query=...` | 市场搜索(名称/排序/价格区间),JSON | 20/分钟 |
| `/market/priceoverview/?appid=&currency=&market_hash_name=` | **单件即时价**(lowest/median/24h volume) | 20/分钟,1000/天 |
| `/market/itemordershistogram` | 买卖挂单深度(需 item_nameid) | 登录态更稳 |
| `/market/pricehistory` | 历史价格曲线 | 需登录态 |
| `/market/listings` / `mylistings` / `myhistory` / `recent` / `popular` | 单品挂单/我的挂单/我的成交历史 | 登录态 |
| `/market/buylisting` / `/market/sellitem` | **购买/出售,写操作强风控** | 登录态 + 高频易封 |

文档:[Search-Market](https://github.com/Revadike/InternalSteamWebAPI/wiki/Search-Market)、[Get-Market-Price-Overview](https://github.com/Revadike/InternalSteamWebAPI/wiki/Get-Market-Price-Overview)。货币代码 `currency`:`1=USD`、`3=EUR`、`5=GBP`、`23=CNY`。自动买/卖有 ToS 与封号风险,SDK 写操作应显式 opt-in(参照 netease 合规红线思路)。

### 3.5 交易报价(Trade Offers)

Web API 侧 `IEconService/GetTradeOffers`(需 key + 权限);社区侧 `/tradeoffer/...` 页面 + `steamcommunity` 库的 `getTradeURL`。自动化交易是封号重灾区,建议只读不写或默认关闭。

### 3.6 其他

好友(`/friends/frienddata`)、群组、评论、愿望单(`/wishlist/profiles/:steamid/wishlistdata`,公开)、评测投票等,全清单在 Revadike wiki;写操作大部分需登录 cookie + sessionid + csrf。

## 4. Steamworks SDK 与协议层

- **Steamworks SDK(C++)**:游戏内 ISteamUser/ISteamFriends/ISteamMatchmaking 等;Web API key 由 Steamworks 后台生成;`GetAuthTicketForWebApi` → 服务端 `AuthenticateUserTicket` 校验。
- **协议层(Node)**:[steam-user](https://github.com/DoctorMcKay/node-steam-user)(SteamKit2 CM 连接,可拿在线状态/聊天/家庭共享等 Web API 拿不到的数据),但模拟客户端自动行为有 ToS 风险。

## 5. 现有 SDK 参考

| 库 | 覆盖 | 评价 |
| --- | --- | --- |
| [steamapi](https://github.com/xDimGG/node-steamapi)(xDimGG) | Web API + Storefront + 部分社区 | TS、面向对象,3.x 起 ESM;`resolve()`/`getUserSummary()` 风格值得参考 |
| [steam-webapi](https://www.npmjs.com/package/steam-webapi)(DoctorMcKay) | 仅 Web API | 薄封装 |
| [steamcommunity](https://github.com/DoctorMcKay/node-steamcommunity) | 登录/资料/市场/交易 | 老牌但回调风格 |
| [steam-session](https://github.com/DoctorMcKay/node-steam-session) | **登录态获取** | 新版登录流程事实标准,值得参考/移植 |
| [steam-user](https://github.com/DoctorMcKay/node-steam-user) | 协议层客户端 | 重、ToS 敏感 |
| [python-valve](https://github.com/serverstf/python-valve) | 多语言实现参考 | 文档化接口清单 |

第三方代理 [api.steamwebapi.com](https://api.steamwebapi.com/steam-api-key) 可免 key 调部分接口,但**不推荐作为 SDK 核心依赖**(可用性/隐私/费用不可控)。

## 6. 对 `@sakurachiyo0v0/steam` 的落地建议

1. **分层模块**:`createSteamClient({ apiKey?, proxy?, sessionPath? })`;域沿用仓库惯例:`.user`(资料)、`.library`(游戏库)、`.stats`(成就/统计)、`.news`、`.store`、`.market`、`.inventory`、`.workshop`、`.auth`。
2. **认证复用 `@sakurachiyo0v0/account`**:登录态存 AuthStore(`<配置根>/amechan/steam/auth.json`);密码登录走 `PasswordLoginAdapter`,QR 走 `QrLoginAdapter`(Steam 移动端扫码是现成 Guard 满足方式);或先做浏览器 cookie 导入。
3. **网络现实**:steamcommunity.com 国内不可达 → 客户端必须支持 `proxy`(HTTP/SOCKS)与自定义 `baseUrl`,README 明示;host 常量化到 `endpoints.ts`(同 booth 包)。
4. **限流与缓存内置**:信号量 + 指数退避 + 尊重 `Retry-After`(复用 lol/vrchat 做法);Storefront/Market 内置 TTL 缓存。
5. **错误模型**:`SteamError` + 错误码(`NETWORK`/`RATE_LIMIT`/`AUTH_EXPIRED`/`LOGIN_REQUIRED`/`PRIVACY_RESTRICTED`/`NOT_FOUND`/`UNKNOWN`),消息脱敏。
6. **合规红线**:市场买卖、自动交易默认不提供或显式 opt-in;不绕 Steam Guard;不伪装发行商密钥。
7. **测试策略**:本地 mock 三台主机(api/store/community)走真实 HTTP 路径(沿用 vrchat/booth 模式);`GetServerInfo` 可作 CI 连通性探针。

## 7. 主要来源

- [官方 Web API Overview](https://partner.steamgames.com/doc/webapi_overview)
- [官方认证文档(Authentication using Web API Keys)](https://partner.steamgames.com/doc/webapi_overview/auth)
- [steamapi.xpaw.me(接口镜像)](https://steamapi.xpaw.me/)
- [TF2 wiki WebAPI](https://wiki.teamfortress.com/wiki/WebAPI)
- [Revadike/InternalSteamWebAPI wiki](https://github.com/Revadike/InternalSteamWebAPI/wiki)
- [DoctorMcKay/node-steam-session](https://github.com/DoctorMcKay/node-steam-session)
- [xDimGG/node-steamapi](https://github.com/xDimGG/node-steamapi)
- [HTTP error 429: Rate limits(社区实测)](https://dev.doctormckay.com/topic/5692-http-error-429-rate-limits/)
- [GetOwnedGames 隐私收紧讨论](https://steamcommunity.com/discussions/forum/1/4333105935814636670/)
