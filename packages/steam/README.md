# @sakurachiyo0v0/steam

Steam SDK(查询向):官方 Web API(`api.steampowered.com`)+ Storefront(`store.steampowered.com`)+ 社区站点(`steamcommunity.com`)。**写操作仅激活码兑换一项**(`redeem`,用户拍板扩展红线);市场买卖、交易创建、好友增删等零写,合规红线固化。

**适用环境:** Node.js 20+,运行在可信任的服务端进程。`steamcommunity.com` 在国内网络不可达,涉及社区主机(库存/市场/登录)的请求需配置 `proxy`。

## 安装方式

同一 pnpm workspace 内:

```powershell
pnpm add @sakurachiyo0v0/steam@workspace:*
```

从 GitHub monorepo 安装(需在消费项目 `pnpm-workspace.yaml` 中授权构建脚本):

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/steam"
```

## 快速开始(P0 基础设施)

```ts
import { createSteamClient, parseSteamId, steamId64ToSteamId3 } from "@sakurachiyo0v0/steam";

const steam = createSteamClient({
  apiKey: process.env.STEAM_API_KEY, // 可选
  proxy: "http://127.0.0.1:7890", // steamcommunity.com 国内不可达时配置
});

const info = await steam.probe(); // 连通性探针,无需 key
console.log(info.servertimestring);

// SteamID 工具
const parsed = parseSteamId("https://steamcommunity.com/id/DimGG/");
console.log(parsed); // { kind: "vanity", vanity: "DimGG" }
console.log(steamId64ToSteamId3("76561198006483290")); // [U:1:46217562]

await steam.close();
```

## P1 公开查询示例

```ts
import { createSteamClient } from "@sakurachiyo0v0/steam";

const steam = createSteamClient({
  apiKey: process.env.STEAM_API_KEY, // 公开查询多数接口需要
  proxy: "http://127.0.0.1:7890", // steamcommunity.com 需代理
});

// 玩家资料(输入支持 steamID64/3/2/vanity/资料页 URL,vanity 自动解析)
const players = await steam.user.getSummaries(["[U:1:46217562]", "STEAM_0:0:23108781"]);
console.log(players[0]?.personaname);

// 游戏库(隐私空结果 → privacyRestricted 标记,不抛错)
const owned = await steam.library.getOwnedGames("76561198006483290");
console.log(owned.gameCount, owned.games[0]?.name, owned.privacyRestricted);

// 成就 / 在线人数
const achievements = await steam.stats.getPlayerAchievements("76561198006483290", 440);
const ccu = await steam.stats.getNumberOfCurrentPlayers(440); // 无需 key

// 商店(本地化,无需 key)
const app = await steam.store.getAppDetails([440], { cc: "cn", l: "schinese" });
console.log(app["440"]?.data?.name);

// 市场只读(community 需代理;默认 TTL 缓存缓解限流)
const price = await steam.market.getPriceOverview(730, "AK-47 | Redline (Field-Tested)", { currency: 23 });
console.log(price.lowest_price);

await steam.close();
```

## P2 登录态示例

```ts
import { createSteamClient } from "@sakurachiyo0v0/steam";

const steam = createSteamClient({
  apiKey: process.env.STEAM_API_KEY,
  proxy: "http://127.0.0.1:7890",
  sessionPath: "./steam-auth.json", // 登录态持久化(AuthStore,默认平台配置目录)
});

// 密码登录(自动识别 Guard:邮箱验证码 / TOTP / 设备确认)
const result = await steam.auth.loginWithPassword({
  accountName: "your_account",
  password: "your_password",
  onNeedCode: async ({ method, message, attempt }) => {
    // 交互环境从用户输入取验证码;此处仅示例
    return await readLine(`[${attempt}] ${message}: `);
  },
  // 有 Steam 手机令牌 shared_secret 时可自动填 TOTP:
  // totpSharedSecret: "base32-secret",
});
console.log(result.saved); // 已持久化

// 二维码登录(Steam 手机 App 扫码)
// await steam.auth.loginWithQr({ autoOpenBrowser: true });

// 会话管理
steam.auth.status(); // { loggedIn, accountName, steamid }
await steam.auth.checkSession(); // 用 refresh_token 实际续期验证
await steam.auth.refreshCookies(); // 重新拉取 web cookie(community 登录态)
await steam.auth.importCookies("steamLoginSecure=...; sessionid=..."); // 导入已有 cookie
await steam.auth.logout(); // 清除 cookie 与存储

await steam.close();
```

### 登录态多端同步(可选)

`remote` 选项接入 `@sakurachiyo0v0/config` 的远程加密命名空间后,登录态双写本地+远程;新机还原时先 `load()` 拉取并回写本地缓存;远程不可达自动降级本地,不影响使用:

```ts
import { AuthStore } from "@sakurachiyo0v0/account";
import { createConfigCenter } from "@sakurachiyo0v0/config";
import { createSteamClient } from "@sakurachiyo0v0/steam";

const remote = createConfigCenter().namespace("auth", { encrypt: true }); // /amechan/secrets/auth

// 新机还原:先从远程拉取登录态回写本地,再构造客户端
await new AuthStore({ platform: "steam", remote }).load();
const steam = createSteamClient({ remote, sessionPath: "./steam-auth.json" });
```

## P3 登录后只读深水区示例

```ts
import { createSteamClient } from "@sakurachiyo0v0/steam";

const steam = createSteamClient({
  apiKey: process.env.STEAM_API_KEY,
  publisherKey: process.env.STEAM_PUBLISHER_KEY, // 可选:GetItemDefs 等
  proxy: "http://127.0.0.1:7890",
  sessionPath: "./steam-auth.json",
});

// 订单簿(买卖挂单深度,匿名可调,登录更稳)
const orders = await steam.market.getItemOrdersHistogram(730, "AK-47 | Redline (Field-Tested)", {
  currency: 23,
});
console.log(orders.lowest_sell_order, orders.sell_order_count);

// 价格历史(价格曲线)
const history = await steam.market.getPriceHistory(730, "AK-47 | Redline (Field-Tested)");
console.log(history.prices.at(-1)); // [时间戳, 价格, 成交量]

// 我的挂单 / 成交历史(需登录态)
const listings = await steam.market.getMyListings();
const myHistory = await steam.market.getMyHistory();

// 自己的库存(需登录态;steamid 取自会话)
const myInv = await steam.inventory.getOwnInventory(730, "2", { language: "schinese" });

// 交易只读(报价 / 历史 / 交易链接;需 key,报价需账号开通 Web API 交易权限)
const offers = await steam.trade.getTradeOffers({ getSentOffers: true, getReceivedOffers: true });
const tHistory = await steam.trade.getTradeHistory({ maxTrades: 50 });
const tradeUrl = await steam.trade.getTradeUrl(); // 需登录态

// 动态流与评论读(公开)
const feed = await steam.user.getActivityFeed("76561198006483290");
const comments = await steam.user.getComments("76561198006483290", { count: 20 });

await steam.close();
```

## 客户端域

| 域 | 能力 |
| --- | --- |
| `client.auth` | `loginWithPassword`(邮箱码/TOTP/设备确认)/ `loginWithQr` / `importCookies` / `status` / `checkSession` / `refreshCookies` / `logout` |
| `client.user` | `getSummaries` / `resolveVanity` / `getPlayerBans` / `getFriendList`(隐私语义)/ `getSteamLevel` / `getBadges` / `getCommunityBadgeProgress` / `getUserGroupList` / `getActivityFeed` / `getComments` |
| `client.library` | `getOwnedGames`(隐私语义)/ `isPlayingSharedGame` / `getRecentlyPlayedGames` / `getWishlist`(公开读,隐私标记) |
| `client.stats` | `getSchemaForGame` / `getPlayerAchievements` / `getUserStatsForGame` / `getGlobalAchievementPercentages` / `getGlobalStats` / `getNumberOfCurrentPlayers` |
| `client.news` | `getNewsForApp`(无需 key) |
| `client.store` | `getAppDetails` / `getFeatured` / `getPackageDetails` / `getDlcForApp` / `search` / `getAppList` / `getAppReviews`(评测,公开)等(无需 key,`cc`/`l` 本地化) |
| `client.inventory` | `getInventory`(公开读)/ `getOwnInventory`(需登录态)/ `getItemDefs`(publisher key) |
| `client.market` | `getPriceOverview` / `search` / `getItemOrdersHistogram`(订单簿)/ `getPriceHistory` / `getMyListings`(需登录)/ `getMyHistory`(需登录),全部只读 |
| `client.workshop` | `getPublishedFileDetails`(无需 key)/ `enumerateUserPublishedFiles` / `enumerateUserSubscribedFiles` |
| `client.trade` | `getTradeOffers` / `getTradeOffer` / `getTradeHistory` / `getTradeUrl`(只读,零写操作) |
| `client.redeem` | `redeemActivationKey`(**写操作**;全 SDK 唯一写能力,需登录态,经用户拍板扩展红线) |

## CLI(`sc-steam`)

```powershell
sc-steam login --account <账号名>        # 密码登录(自动识别邮箱码/TOTP/设备确认)
sc-steam login --qr                      # 二维码登录(手机 App 扫码)
sc-steam login --cookie "steamLoginSecure=...; sessionid=..."   # 导入浏览器 cookie
sc-steam status                          # 登录状态
sc-steam user "76561198006483290"        # 资料摘要(vanity/URL 自动解析)
sc-steam owned-games "76561198006483290" # 游戏库
sc-steam achievements "76561198006483290" 440
sc-steam price 730 "AK-47 | Redline (Field-Tested)" --currency 23
sc-steam search "AK-47" --appid 730
sc-steam inventory "76561198006483290" 730 2
sc-steam my-listings                     # 我的挂单(需登录态)
sc-steam reviews 730 --language schinese # 商店评测(公开)
sc-steam watch 730 "AK-47 | Redline (Field-Tested)" --currency 23  # 价格监控:即时价+订单簿+历史
sc-steam redeem "AAAAA-BBBBB-CCCCC"      # 兑换激活码(写操作,需登录态)
sc-steam logout
```

- 默认输出 JSON;`--proxy`/`AMECHAN_STEAM_PROXY` 配置代理(community 国内不可达)。
- 环境变量:`AMECHAN_STEAM_AUTH_PATH` / `AMECHAN_STEAM_API_KEY` / `AMECHAN_STEAM_PUBLISHER_KEY` / `AMECHAN_STEAM_BASE_URLS`(JSON 覆盖四主机)。
- 详细手册见 [`skills/steam-cli/SKILL.md`](../../skills/steam-cli/SKILL.md)。
- **写操作仅 `redeem` 激活码兑换一项**(用户拍板扩展红线);市场买卖/交易创建/好友增删等仍零写。

## 客户端选项

| 选项 | 说明 |
| --- | --- |
| `apiKey` | Steam Web API user key(可选;需要 key 的方法未配置时抛 `CONFIGURATION`) |
| `publisherKey` | 发行商密钥(可选;publisher 方法专用) |
| `proxy` | `http(s)://` 或 `socks5://` 代理(undici ProxyAgent) |
| `baseUrls` | 覆盖四台主机(测试/镜像) |
| `sessionPath` | AuthStore 路径(P2 登录态) |
| `remote` | 远程登录态命名空间(配置中心加密域);登录态双写本地+远程,远程不可达降级本地 |
| `fetchImpl` | 可注入 fetch 实现(默认 undici fetch) |
| `timeoutMs` | 单请求超时,默认 15000 |
| `maxRetries` | 429 最大重试次数,默认 2(尊重 `Retry-After`,上限 10s) |
| `cache` | TTL 缓存(`enabled` 默认 true,`ttlMs` 默认 60000;仅 GET 无 body 请求命中) |
| `cookie` | 会话 cookie 串(P2 登录态自动注入) |

## 错误码

| 错误码 | 含义 | 上层提示 |
| --- | --- | --- |
| `NETWORK` | 网络失败 | 检查网络/代理 |
| `TIMEOUT` | 请求超时 | 稍后重试 |
| `RATE_LIMIT` | 429 限流(退避重试仍失败) | 稍后重试 |
| `AUTH_EXPIRED` | 密钥无效或会话失效 | 重新登录 |
| `LOGIN_REQUIRED` | 需要登录态(P2) | 请先登录 |
| `FORBIDDEN` | 权限不足或资料未公开 | 检查权限 |
| `NOT_FOUND` | 资源不存在 | 检查输入 |
| `INVALID_URL` | Steam ID / 链接无法解析 | 检查输入 |
| `INVALID_CREDENTIALS` | 账号密码错误(P2) | 检查凭据 |
| `TWO_FACTOR_REQUIRED` | 需要 2FA 验证码(P2) | 输入验证码 |
| `TWO_FACTOR_FAILED` | 2FA 验证失败(P2) | 重试 |
| `CONFIGURATION` | 缺少必需配置(如 key) | 补充配置 |
| `UNKNOWN` | 未归类错误 | 查看日志 |

错误消息一律脱敏,不输出 key / cookie / 密码 / 会话串。

## 当前进度

- [x] P0 基础设施:三主机 HTTP 层(proxy/key/cookie/429 退避/TTL 缓存)、`probe()`、`GetSupportedAPIList`、`SteamError`、SteamID 工具、客户端工厂
- [x] P1 公开查询:user / library / stats / news / store / 公开库存 / 市场价格(只读)
- [x] P2 登录态:密码+Guard(邮箱码/TOTP/设备确认)/ QR 扫码 / cookie 导入 / 会话续期与持久化(AuthStore)+ 好友/等级/徽章/群组/近期游戏/愿望单读/创意工坊
- [x] P3 登录后只读深水区:订单簿 / 价格历史 / 我的挂单与成交 / 自己库存 / 物品定义(publisher key)/ 交易报价与历史只读 / 动态流与评论读
- [x] P5 收尾(部分):README / packages-index / spec 标记、`sc-steam` CLI + skill(11 命令,守卫校验通过)、版本 0.4.0
- [ ] P5 剩余:用户确认后提交推送 → CI 发布 → `pnpm verify:published @sakurachiyo0v0/steam` 消费验证

设计 spec:[`docs/superpowers/specs/2026-08-23-steam-sdk-design.md`](../../docs/superpowers/specs/2026-08-23-steam-sdk-design.md);调研报告:[`docs/steam-api-research.md`](../../docs/steam-api-research.md)。

## 在仓库内的验证方式

```powershell
pnpm --filter @sakurachiyo0v0/steam typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/steam test        # 单测(mock 四台主机走真实 HTTP 协议路径,含 RSA 密码往返)
pnpm --filter @sakurachiyo0v0/steam build       # 构建 ESM + CJS + d.ts
```
