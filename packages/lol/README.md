# `@sakurachiyo0v0/lol`

League of Legends 英雄联盟客户端本地能力 SDK。封装 **LCU API**（League Client Update，客户端暴露的本机 HTTP/WebSocket 接口），提供召唤师、战绩、段位、对局流程、选人阶段、游戏数据等能力，供其他 Node.js 应用直接使用。

> ⚠️ **运行形态（硬约束）**：LCU 只存在于「本机正在运行的英雄联盟客户端」上，通过 `127.0.0.1` 访问。本 SDK 是**进程内、本机**的 SDK，消费方必须是运行在用户机器上的 Node 进程（Electron 主进程、CLI、本地 Web 后端），不能做成云端 SaaS。
>
> ⚠️ **合规与风险**：本 SDK 完全基于 Riot 公开的 LCU API，不含对客户端文件/内存的读取或修改。只读查询（战绩/段位/对局状态）与展示层设置（生涯背景/签名/段位展示）风险极低；**自动操作类接口**（`champSelect.pick` / `ban` / `acceptTrade` / `acceptSwap`、`gameflow.dodge`、自动 B/P 编排等）属灰色地带，可能违反 Riot/腾讯规则，**不保证不封号**，调用方自担风险。Seraphine is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.

## 环境要求

- Node.js >= 20
- Windows（进程发现依赖 tasklist + PowerShell，目前仅支持 Windows 本机客户端）
- 运行期间本机已登录并启动英雄联盟客户端（LeagueClientUx.exe）

> 💡 **已知限制（真实联调验证）**：若客户端以**管理员权限**启动（腾讯/WeGame 启动的客户端常见），普通权限进程读不到它的命令行参数，自动发现会失败并抛 `DISCOVERY_FAILED`（`ExecutablePath`/`CommandLine` 读取为 null，属 Windows UAC 跨完整性级别限制）。此时有两种处理：① 让消费进程以管理员身份运行（可正常自动发现）；② 手动指定连接参数跳过发现：
>
> ```ts
> const client = await createLolClient({
>   connection: { pid: <pid>, port: <app-port>, token: "<remoting-auth-token>" },
> });
> ```
>
> 参数可从「任务管理器 → 详细信息 → 右键列头勾选『命令行』」中 `LeagueClientUx.exe` 一行提取。
>
> 💡 **国服账号名（Riot ID）**：国服新版客户端下 `getCurrent()` 返回的 `displayName` 可能为空，召唤师名在 `gameName`（ID 后缀在 `tagLine`，如 `Twistzz#47939`）。取显示名建议 `gameName || displayName`。按名字搜索需带完整 Riot ID：`searchByRiotId(gameName, tagLine)`，纯 `gameName` 查询返回空数组。
>
> 💡 **赛后数据的时间线限制（实测）**：`getGameDetail()` 返回的 `participants[].timeline` 中 `creepsPerMinDeltas` 等每分钟曲线字段在新版客户端为**空对象**，且 LCU 无独立 timeline 端点（`/lol-match-history/v1/games/{id}/timeline` 返回 404）——分钟级数据在国服 LCU 渠道拿不到；`timeline.lane` / `role` 仍可用。其余赛后字段（118 项 stats、符文全量、ban/龙/塔团队数据等）完整可用。

## 安装

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/lol@workspace:*
```

从 GitHub monorepo 安装（需在消费项目 `pnpm-workspace.yaml` 中授权构建脚本）：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/lol"
```

## 快速开始

```ts
import { createLolClient } from "@sakurachiyo0v0/lol";

// 自动发现本机 LCU 并连接
const client = await createLolClient();

// 当前召唤师
const me = await client.summoner.getCurrent();
console.log(me.gameName || me.displayName); // 国服 Riot ID 用 gameName（displayName 可能为空）

// 战绩列表（最近 20 场）
const games = await client.matchHistory.getMatches(me.puuid, { begIndex: 0, endIndex: 19 });
console.log(`共 ${games.gameCount} 场，本次返回 ${games.games.length} 场`);

// 对局状态 + 事件订阅
const phase = await client.gameflow.getPhase();
console.log("当前阶段:", phase);

const off = client.events.onGameflowPhase((next) => {
  console.log("阶段变为:", next);
});

// 段位（国服自动走 SGP 通道可用 client.sgp / getStatsViaSgp）
const rank = await client.ranked.getStats(me.puuid);

// 用完关闭
off();
await client.close();
```

## API 一览

| 模块 | 方法 | 说明 |
| --- | --- | --- |
| `client.summoner` | `getCurrent()` / `getByName(name)` / `getByPuuid(puuid)` / `getProfile()` | 召唤师信息与资料页 |
| `client.matchHistory` | `getMatches(puuid, {begIndex, endIndex})` / `getMatchesViaSgp(puuid)` / `getGameDetail(gameId)` | 战绩列表与对局详情；`ViaSgp` 仅国服，返回 `{games:[...]}`（metadata 格式） |
| `client.ranked` | `getStats(puuid)` / `getStatsViaSgp(puuid)` | 段位统计 |
| `client.gameflow` | `getPhase()` / `getSession()` / `getReadyCheck()` / `acceptReadyCheck()` / `dodge()` / `reconnect()` / `playAgain()` / `spectate(name, puuid)` | 对局流程控制（dodge/spectate 有风险，谨慎） |
| `client.gameData` | `getChampions()` / `getItems()` / `getSummonerSpells()` / `getRunes()` / `getQueues()` / `fetchAsset(iconPath)` | 静态数据与资源获取 |
| `client.champSelect` | `getSession()` / `getMySelection()` / `pick(actionId, championId)` / `ban(actionId, championId)` / `completeAction(actionId)` / `acceptTrade(id)` / `acceptSwap(id)` / `benchSwap(championId)` / `reroll()` / `selectConfig({skinId,...})` / `getCurrentRunePage()` / `createRunePage({...})` / `deleteRunePage(id)` | 选人阶段操作（⚠️ 见下方风险披露） |
| `client.lobby` | `create5v5PracticeLobby({name, password?, mapId?, queueId?})` / `getLobby()` / `playAgain()` | 自定义训练房（顶层 queueId 默认 3100，新版客户端必填） |
| `client.profile` | `setBackground(skinId)` / `setBackgroundAugments(contentId)` / `setProfileIcon(iconId)` / `setRankShown(queue, tier, division)` / `removeTokens()` / `removePrestigeCrest()` | 生涯/个性化设置 |
| `client.chat` | `getMe()` / `setStatus(message)` / `setAvailability(a)` / `getConversations()` / `sendMessage(convId, body)` / `sendFriendRequest(name)` / `sendNotification({title, content})` | 聊天/社交 |
| `client.events` | `onGameflowPhase(cb)` / `onChampSelect(cb)` / `onCurrentSummoner(cb)` / `onSgpToken(cb)` / `subscribe(eventName, cb)` | WebSocket 事件订阅 |
| `client.liveClient` | `getAllGameData()` / `getPlayerList()` / `getActivePlayer()` / `getActivePlayerName()` / `getGameStats()` / `getEventData()` / `getScores()` / `getItems()` / `getAbilities()` / `getRunes()` / `getPlayerXxx(name)` | 游戏内 Live Client Data（端口 2999，只读；⚠️ **国服客户端实测不可用**：端口由游戏进程监听但 `/liveclientdata` 无响应，疑似国服/反作弊限制；海外客户端可用性未验证，该 API 近期仍有社区项目在使用） |
| `client.sgp` | `getMatches()` / `getRankedStats()` / `getSummonerByPuuid()` / `getSpectatorInfo()` | 腾讯国服 SGP 通道（非国服为 `undefined`） |
| `client.championNames` | `getName(id)` / `getMap()` / `refresh()` | 英雄名映射（id → 中文名）：内置全量表离线可用，运行时自动从 CommunityDragon latest 通道更新，出新英雄自动生效；不依赖 LCU 连接 |

**parsers 解析层**（纯函数，无 IO，把 raw JSON 转友好结构）：

```ts
import { parseMatchSummary, getRecentChampions, parseRankSummaryFromSgp, formatDuration } from "@sakurachiyo0v0/lol";

const games = await client.matchHistory.getMatches(puuid);
const results = games.games.map((g) => parseMatchSummary(g, puuid)); // 每场 KDA/胜负/英雄
const champs = getRecentChampions(results);                          // 常用英雄 Top10（跳过自定义，remake 不计胜负）
const rank = parseRankSummaryFromSgp(await client.sgp!.getRankedStats(puuid)); // { solo: {tier, division, lp}, flex: {...} }
console.log(`${formatDuration(results[0].gameDuration)}  ${results[0].kda}`);
```

`getTeammates(match, puuid)` 可提取对局队友/对手；`parseRankSummary()` 解析 LCU 段位格式。全部为纯函数，可直接在 Node 或浏览器端使用。

**英雄名映射**（内置表 + 自动更新，无需连接客户端）：

```ts
import { ChampionNamesService, BUILTIN_CHAMPION_NAMES } from "@sakurachiyo0v0/lol";

const names = new ChampionNamesService();           // 默认源 CommunityDragon latest zh_cn
const name = await names.getName(876);              // "含羞蓓蕾"（缓存 24h，过期自动刷新）
const map = await names.getMap();                   // 全量 {id → 中文名}
console.log(BUILTIN_CHAMPION_NAMES[103]);           // "九尾妖狐"（内置表，离线可用）
await names.close();
```

拉取失败时静默回退内置表（或上次成功缓存），不会抛错；可用 `new ChampionNamesService({ sourceUrl, cacheTtlMs, timeoutMs })` 自定义数据源（测试可注入本地地址）。

端点返回的 raw JSON 原样透传，TypeScript 类型只做描述；需要高层解析（KDA、对局摘要）的场景由调用方自行处理。

## 自定义连接

```ts
// 显式指定连接（多客户端 / 测试场景）
const client = await createLolClient({
  connection: { pid: 1234, port: 54321, token: "xxx", server: "HN1" },
  concurrency: 8,     // 并发请求上限，默认 8
  timeoutMs: 15000,   // 请求超时，默认 15s
});
```

## 错误码

统一 `LolError`（`code` / `message` / `cause`），公开消息已脱敏（不含 token、命令行原文）：

| 错误码 | 场景 |
| --- | --- |
| `CLIENT_NOT_RUNNING` | 未发现 LeagueClientUx 进程 |
| `DISCOVERY_FAILED` | 找到进程但读不到 port/token |
| `CONNECTION` | REST/WS 连接失败、5xx 服务错误（GET 会自动重试 3 次）、断线 |
| `NOT_FOUND` | 召唤师/战绩/对局不存在 |
| `RATE_LIMIT` | 请求被限流（429） |
| `AUTH` | token 失效（401/403） |
| `TIMEOUT` | 请求超时 |
| `UNKNOWN` | 其他 |

```ts
import { LolError } from "@sakurachiyo0v0/lol";

try {
  await client.summoner.getByName("不存在的名字");
} catch (error) {
  if (error instanceof LolError && error.code === "NOT_FOUND") {
    // 处理未找到
  }
}
```

## 验证命令

```powershell
pnpm --filter @sakurachiyo0v0/lol typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/lol test        # 单测（本地 mock LCU 服务器，走真实 HTTP/WS 协议）
pnpm --filter @sakurachiyo0v0/lol build       # 构建 ESM + CJS + d.ts
```

真实客户端联调（本机有客户端时）：

```ts
import { createLolClient } from "@sakurachiyo0v0/lol";
const client = await createLolClient();
const me = await client.summoner.getCurrent();
console.log("已连接:", me.displayName);
await client.close();
```

## 实现说明

- **进程发现**：`tasklist` 找 `LeagueClientUx.exe` PID → PowerShell `Get-CimInstance` 读命令行 → 解析 `--app-port` / `--remoting-auth-token` / `--rso_platform_id`。
- **传输**：undici（忽略自签名证书）+ BasicAuth `riot:<token>`；信号量限流；GET 幂等请求指数退避重试 3 次，写操作不重试。
- **事件**：`wss://127.0.0.1:<port>/`，`[5, eventName]` 订阅，`[8, eventName, payload]` 分发；断线自动重连（最多 5 次）。
- **国服 SGP**：检测到腾讯服务器（HN1/HN10/BGP2/NJ100/GZ100/CQ100/TJ100/TJ101）时启用，token 来自 `/entitlements/v1/token` 并随事件刷新。
- **参考**：LCU 官方文档（[lcu-schema](https://www.mingweisamuel.com/lcu-schema/tool/)、[Hextech Docs](https://hextechdocs.dev/tag/lcu/)）；设计思路参考开源项目 [Seraphine](https://github.com/Zzaphkiel/Seraphine)（GPLv3），**本包代码完全自研，无代码复制**。

## 设计文档

详见 `docs/superpowers/specs/2026-08-22-lol-sdk-design.md`（能力清单、分阶段规划、关键机制、测试策略）。
