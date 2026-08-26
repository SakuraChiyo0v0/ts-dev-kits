# @sakurachiyo0v0/steam Steam SDK 设计

状态:用户已批准(2026-08-23)
日期:2026-08-23
前置调研:[`docs/steam-api-research.md`](../steam-api-research.md)

## 1. 当前问题与目标

- 现状:仓库无 Steam 相关 SDK;Steam 接口零散(官方 Web API / Storefront / 社区内部 API 三套体系),认证分级复杂(公开 / user key / publisher key / 登录 cookie),且 `steamcommunity.com` 在国内网络不可达,自行接入成本高、易踩限流与隐私坑。
- 目标:提供一个 **查询向、覆盖登录态能力**的完整 Steam SDK。分阶段交付(逐项实现,不图快):
  - P0 基础设施(HTTP 层 / 错误模型 / SteamID 工具 / 客户端工厂)
  - P1 公开查询(资料 / 游戏库 / 成就统计 / 新闻 / 商店 / 公开库存 / 市场价格)
  - P2 登录态(四种登录方式 + 私密资料 / 好友 / 徽章 / 愿望单读 / 创意工坊订阅)
  - P3 登录后只读深水区(自己多 App 库存 / 订单簿 / 价格历史 / 我的挂单与成交历史 / 交易报价只读 / 动态流与评论读)
  - P5 收尾(README / packages-index / CLI / skill / 版本 / 发布验证)
- **合规边界:默认零写操作;唯一例外为 `redeem` 激活码兑换**(用户拍板扩展红线,2026-08-24)。市场买卖、交易创建/接受、好友增删、愿望单写等仍一律不提供。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 每次对接要自己处理三套主机、key、cookie、限流、隐私空结果 | 一行 `createSteamClient({ apiKey?, proxy? })` 自动分层携带凭证与限流 |
| 登录态(密码+Guard / QR / cookie)各写各的 | 复用 `@sakurachiyo0v0/account` 骨架 + AuthStore,登录/持久化/刷新/登出统一 |
| steamcommunity.com 国内不可达,方案落地即失败 | proxy / 自定义 baseUrl 内置,README 明示,host 集中在 `endpoints.ts` |
| 错误五花八门、泄露请求细节 | 统一 `SteamError` + 错误码,消息脱敏 |
| 市场/交易类自动化有封号风险 | SDK 只读 + 挂单查看,写操作一律不提供(合规固化) |

## 3. 方案选择

### 方案 A:依赖现成 npm 包(steam-session / steamcommunity 等)(不采用)

- 优点:省维护,协议更新跟上游。
- 缺点:引入重依赖链,登录行为不可控,与仓库"薄依赖、自研核心"风格冲突(lol 规避 GPL、bilibili 自研 WBI 的先例);需要网络安装风险(steamcommunity.com 相关包在 CI/国内安装受限)。

### 方案 B:全部从零自研(不采用)

- 优点:完全可控。
- 缺点:登录协议(LoginSession 的 Guard 轮询、refresh、cookie 提取)底层细节多,纯从零写性价比低。

### 方案 C:自研实现 + 参考开源协议细节,复用 account 骨架(采用)

- 优点:零第三方运行时登录依赖;登录流程细节参考 MIT 开源的 `steam-session` 等实现(密码+Guard 轮询 / QR / refresh / web cookie 提取);复用 `@sakurachiyo0v0/account` 的 `PasswordLoginAdapter` / `QrLoginAdapter` / `AuthStore`,与仓库其他包体验一致。
- 缺点:需要投入实现登录协议的时间(可接受,分阶段 P2 专门做)。

## 4. 仓库结构

```text
packages/steam/
├─ src/
│  ├─ index.ts            公共出口:只导出稳定 API
│  ├─ client.ts           createSteamClient() 工厂;域对象挂载
│  ├─ types.ts            核心类型与枚举(SteamID、错误码、物品、市场,字段语义权威定义)
│  ├─ endpoints.ts        三台 host(api/store/community)+ 全部端点常量
│  ├─ http.ts             HTTP 核心层(undici):proxy/自定义 baseUrl/重试退避/429/TTL 缓存/脱敏日志
│  ├─ errors.ts           SteamError + 错误码
│  ├─ steamid.ts          SteamID64/3/2/vanity 互转与校验(自研)
│  ├─ auth/
│  │  ├─ loginSession.ts  自研登录协议(参考 MIT steam-session 细节)
│  │  ├─ adapters.ts      SteamPasswordAdapter / SteamQrAdapter(实现 account 契约)
│  │  └─ session.ts       登录态持久化(AuthStore)/ 刷新 / web cookie 提取与注入
│  ├─ api/
│  │  ├─ user.ts          library.ts  stats.ts  news.ts  store.ts
│  │  ├─ inventory.ts     market.ts  workshop.ts  trade.ts
│  │  └─ auth.ts          登录/登出/会话状态
│  └─ cli/                sc-steam(P5 阶段按需)
├─ tests/                 Vitest:mock 三台主机走真实 HTTP 协议路径
├─ package.json           版本 0.1.0 / exports / scripts
└─ README.md              安装 / API / 参数表 / 错误码 / 网络注意事项
```

## 5. 接口设计

### 5.1 客户端工厂

```ts
createSteamClient(options: SteamClientOptions): SteamClient

interface SteamClientOptions {
  apiKey?: string;        // user key(可选;不传则公开无 key 方法可用)
  publisherKey?: string;  // 可选;无则 GetItemDefs 等方法抛 CONFIGURATION
  proxy?: string;         // http(s):// 或 socks5://,默认无
  baseUrls?: Partial<Record<Host, string>>; // 覆盖 api/store/community 主机
  sessionPath?: string;   // AuthStore 路径,默认 <配置根>/amechan/steam/auth.json
  fetchImpl?: FetchLike;  // 可注入(默认 undici)
  cache?: CacheOptions;   // TTL 缓存开关与时长(store/market 默认开)
}
```

### 5.2 域模块(方法签名略,按清单逐项实现)

- `client.user`:`getSummaries(ids)` / `resolveVanity(url|vanity)` / `getPlayerBans(ids)` / `getFriendList(steamid)`(隐私受限)/ `getSteamLevel(steamid)` / `getBadges(steamid)` / `getCommunityBadgeProgress(steamid, appid)`
- `client.library`:`getOwnedGames(steamid, { includeAppInfo?, includePlayedFreeGames?, appidsFilter? })`(隐私空结果 → `PRIVACY_RESTRICTED` 语义区分)/ `isPlayingSharedGame(steamid, appid)`
- `client.stats`:`getSchemaForGame(appid)` / `getPlayerAchievements(steamid, appid)` / `getUserStatsForGame(steamid, appid)` / `getGlobalAchievementPercentages(appid)` / `getGlobalStatsForGame(appid, stats)` / `getNumberOfCurrentPlayers(appid)`
- `client.news`:`getNewsForApp(appid, { count?, maxLength?, feeds? })`
- `client.store`:`getAppDetails(appids, { cc?, l? })` / `getFeatured({ cc?, l? })` / `getPackageDetails(packageIds)` / `getDlcForApp(appid)` / `search(query, { cc?, l? })` / `getAppList()`
- `client.inventory`:`getInventory(steamid, appid, contextId, { count?, startAssetId?, language? })`(分页)/ `getOwnInventory(appid, contextId, ...)`(需登录态)
- `client.market`:`getPriceOverview(appid, marketHashName, { currency? })` / `search({ appid?, query?, sort?, priceMin?, priceMax? })` / `getItemOrdersHistogram(...)`(登录态更稳)/ `getPriceHistory(appid, marketHashName)`(登录态)/ `getMyListings()` / `getMyHistory()`(登录态)
- `client.workshop`:`getPublishedFileDetails(publishedFileIds)`(无 key 可调)/ `enumerateUserPublishedFiles(steamid)` / `enumerateUserSubscribedFiles(steamid)`(需登录态)
- `client.trade`(只读):`getTradeOffers({ getSentOffers?, getReceivedOffers? })` / `getTradeHistory(...)` / `getTradeUrl()`(需登录态)
- `client.auth`:`login({ username, password, onNeedCode? })`(密码+邮箱码/TOTP)/ `loginWithQr()` / `importCookies(cookies)` / `checkSession()` / `logout()` / `status()`
- `client.steamid`(或独立导出):`SteamID.parse(input)` / `toSteamID64()` / `toSteamID3()` / `toSteamID2()` / `getVanity(input, { apiKey? })`

### 5.3 认证与数据流

1. Web API 请求:`key`(user/publisher)经 query 或 `X-WebAPI-Key` 头;无 key 的公开方法不附加。
2. community/store 请求:自动携带 AuthStore 中的 web cookies(含 `sessionid` 作 csrf);未登录但需要登录的方法抛 `LOGIN_REQUIRED`。
3. 登录流程(优先序):密码+邮箱验证码 → TOTP(shared_secret)→ QR 扫码 → cookie 导入;`LoginSession` 完成后持久化 `{ accessToken, refreshToken, cookies, steamGuardMachineToken? }`;refreshToken 到期前自动刷新,失败 → `AUTH_EXPIRED`。
4. 隐私语义:`GetOwnedGames`/`GetFriendList` 因目标资料非公开而返回空 → **不抛错**,返回 `{ items, privacyRestricted: true }` 形态(`privacyRestricted` 为结果标记而非错误);`getOwnedGames`/`getFriendList` 返回对象含该字段,其余列表方法不受影响。

## 6. 错误处理

| 错误码 | 含义 | 上层提示 |
| --- | --- | --- |
| `NETWORK` | 网络失败 | 检查网络/代理 |
| `TIMEOUT` | 请求超时 | 稍后重试 |
| `RATE_LIMIT` | 429 限流(已退避重试仍失败) | 稍后重试 |
| `AUTH_EXPIRED` | 登录态过期 | 重新登录 |
| `LOGIN_REQUIRED` | 需要登录态 | 请先登录 |
| `FORBIDDEN` | 权限不足或资料未公开 | 检查权限 |
| `NOT_FOUND` | 资源不存在 | 检查输入 |
| `INVALID_URL` | 链接/输入无法解析 | 检查输入 |
| `INVALID_CREDENTIALS` | 账号密码错误 | 检查凭据 |
| `TWO_FACTOR_REQUIRED` | 需要 2FA 验证码 | 输入验证码 |
| `TWO_FACTOR_FAILED` | 2FA 验证失败 | 重试 |
| `CONFIGURATION` | 缺少必需配置(如 publisher key) | 补充配置 |
| `UNKNOWN` | 未归类错误 | 查看日志 |

消息一律脱敏(不泄露 key / cookie / 密码 / 会话串)。

## 7. 测试策略

- 本地 mock 三台主机(`api.steampowered.com` / `store.steampowered.com` / `steamcommunity.com`),真实 HTTP 协议路径(沿用 vrchat/booth 模式),通过 `baseUrls` 注入。
- mock 登录全流程:密码+Guard 轮询、TOTP、QR 轮询、refresh 刷新、web cookie 提取;覆盖 guard 需要/失败分支。
- 错误分支:429(含 `Retry-After`)、401 → `AUTH_EXPIRED`、隐私空结果、网络失败、超时、参数非法。
- 缓存单测:TTL 命中/过期、多 key 隔离。
- 无写操作 → 无需"写操作自清理"。
- 可选 CI 冒烟:`GetServerInfo` 探针(注意国内 CI 网络,失败不阻断,标 skip)。

## 8. CLI 与 skill 同步

- P5 按需提供 `sc-steam` CLI,计划命令:`login` / `status` / `logout` / `user` / `owned-games` / `achievements` / `price` / `search` / `inventory` / `my-listings`(登录态命令需先 `login`)。
- 若提供 CLI:新增 `skills/steam-cli/SKILL.md`,命令集与参数表必须同步(提交守卫 `check-skill-staleness.mjs` 会拦命令集不一致)。
- 若 P5 决定不做 CLI,则无 skill 同步义务,本项删除。

## 9. 版本与发布

- 起步版本 `0.1.0`;每次改动按 patch/minor 规则 bump,同步 `docs/packages-index.md`。
- 阶段交付各 bump minor;P0 骨架合入后即可 bump 0.1.0。
- 发布:push main 触发 `publish.yml`,发布后 `pnpm verify:published @sakurachiyo0v0/steam` 消费验证。
- 依赖:`@sakurachiyo0v0/account`(workspace:*)与 `undici`;依赖图单向无环(account 不依赖 steam)。

## 10. 验收条件

- [x] P0:客户端工厂/HTTP 层/错误模型/SteamID 工具可用,`GetServerInfo` 探针跑通 ✅
- [x] P1:公开查询域全部方法可用(含本地化与隐私空结果语义)✅
- [x] P2:四种登录方式 + 持久化/刷新/登出可用,登录后私密能力可用 ✅(密码+邮箱码/TOTP/设备确认、QR、cookie 导入、checkSession/refreshCookies/logout,好友/等级/徽章/群组/近期游戏/愿望单读/创意工坊;v0.3.0)
- [x] P3:登录后只读深水区全部可用 ✅(订单簿 itemordershistogram / 价格历史 pricehistory / 我的挂单 mylistings / 成交历史 myhistory / 自己库存 getOwnInventory / 物品定义 GetItemDefs(publisher key)/ 交易报价与历史只读 GetTradeOffers|GetTradeOffer|GetTradeHistory / 交易链接 / 动态流与评论读;v0.4.0)
- [x] 测试全绿(含错误分支);零写接口 + 唯一写例外 redeem ✅(113/113;激活码兑换经用户拍板扩展红线,2026-08-24)
- [x] 新能力:商店评测 getAppReviews(公开)+ 价格监控 CLI watch + 激活码兑换 redeem(真实协议:store /account/registerkey 302+Set-Cookie 会话刷新 → ajaxregisterkey JSON,ePurchaseResult 码映射)✅(v0.5.0,2026-08-24)
- [x] README + packages-index 更新;CLI 已同步 skill ✅(`sc-steam` 14 命令,`check-skill-staleness` 校验通过)
- [ ] `pnpm check` 通过;用户确认后提交推送,CI 发布成功,消费验证通过(提交/推送/发布需用户授权)

## 11. 待办映射(能力清单 → 阶段)

| 阶段 | 清单项 |
| --- | --- |
| P0 | K1-K5(HTTP 层 / 探针 / 错误模型 / SteamID 工具 / 工厂) |
| P1 | B1-B3 / C1-C2 / D1-D5 / E1-E2 / F1-F5 / G1 / H1-H2 |
| P2 | A1-A5(登录四种 + 会话管理)/ B4-B7 / C3 读 / E3 |
| P3 | G2-G3(publisher key 可选)/ H3-H5 / I 只读 / J 读 |
| P5 | 文档 / CLI / skill / bump / 发布验证 |
