# `@sakurachiyo0v0/lol` 英雄联盟本地能力 SDK 设计

状态：用户已批准
日期：2026-08-22

## 1. 当前问题与目标

仓库内目前没有任何英雄联盟（LoL）相关能力。任何项目要对接英雄联盟客户端（LCU，League Client Update）都必须从零处理：进程发现、自签名证书、BasicAuth、请求限流与重试、WebSocket 事件订阅、国服（腾讯）专属通道等一整套繁琐且有坑的机制。

本次目标是在 `ts-dev-kits` monorepo 中创建 `@sakurachiyo0v0/lol`：

- **从零实现**：只参考 LCU 官方 API 文档（`https://www.mingweisamuel.com/lcu-schema/tool/`、Hextech Docs 等）与开源项目 Seraphine（`Zzaphkiel/Seraphine`，GPLv3）的设计思路，**不复制其代码**，规避 GPLv3 版权传染，保证 SDK 可商用、可自由许可；
- 覆盖英雄联盟客户端本地能力：召唤师、战绩、段位、对局流程、选人阶段、房间、聊天、个性化、游戏数据，以及游戏内 Live Client Data API；
- 提供统一、类型安全、可测试的调用接口；国服与海外服都可用；
- 能力分阶段交付，每阶段独立可用；v0.1.0 首发 = 基础设施 + 战绩查询 + 对局感知。

**运行形态（硬约束）**：LCU 只存在于「本机正在运行的英雄联盟客户端」上，通过 localhost 访问。因此本 SDK 是**进程内、本机**的 SDK，消费方是运行在用户机器上的 Node 进程（Electron 主进程、CLI 工具、本地 Web 后端），不能做成云端 SaaS。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 每个项目对接 LCU 都要自己处理进程发现/证书/重试/事件订阅 | 一行 `createLolClient()` 自动发现并连接，能力按领域模块调用 |
| 错误结构、重试策略不一致，token 易被日志泄露 | SDK 统一 `LolError` + 错误码，消息脱敏 |
| 国服战绩查询需要自行摸索腾讯 SGP 通道 | SDK 检测到腾讯服务器自动启用 SGP |
| 没有独立验证方式 | 通过本地 mock LCU 服务器做真实协议路径测试 |
| Seraphine 代码无法直接复用（GPLv3、Python、GUI 耦合） | 纯 TS 从零实现，许可自由 |

## 3. 方案选择

### 方案 A：把 Seraphine 核心移植为 TS 库（不采用）

Seraphine 的 `connector.py` + `tools.py` 质量高、可直接参考。但直接移植代码意味着继承 GPLv3 且**禁止商用**，与 SDK 长期复用目标冲突。且 Python→TS 逐行翻译并不比按文档重写省多少。

### 方案 B：从零实现 TS SDK，按 LCU 官方文档建模（采用）

参照对象只有「LCU 官方 API」这一公开事实，设计思路借鉴 Seraphine（信号量限流、重试装饰器、事件订阅装饰器、SGP 通道），实现完全自研。许可证不受限，接口可按 TS 生态习惯设计（Promise、类型、EventEmitter 风格订阅）。

### 方案 C：本地桥接服务（暂不采用）

做一个常驻本地服务（REST/WebSocket）封装 LCU，任何语言的应用都能调用。适合多语言、多进程消费场景，但引入独立进程的部署、运维、鉴权和崩溃恢复成本。本仓库消费方以 TS 为主，先做进程内 SDK；若未来出现跨语言需求，可以在 `@sakurachiyo0v0/lol` 之上再加一层桥接服务，不冲突。

## 4. 仓库结构

```text
ts-dev-kits/
├─ packages/
│  └─ lol/
│     ├─ src/
│     │  ├─ index.ts             公共出口：只导出稳定 API
│     │  ├─ client.ts            createLolClient() 门面
│     │  ├─ discovery.ts         进程发现：LeagueClientUx.exe → port/token/server
│     │  ├─ transport.ts         LcuTransport 接口（REST + WS，供应商无关）
│     │  ├─ http-transport.ts    真实实现：undici + ws + 信号量限流 + 重试
│     │  ├─ events.ts            事件订阅：OnJsonApiEvent 订阅与路由
│     │  ├─ types.ts             LCU 领域类型（Summoner/Game/Rank/ChampSelectSession…）
│     │  ├─ errors.ts            LolError + 错误码 + 归类函数
│     │  ├─ sgp.ts               （可选）腾讯 SGP 通道
│     │  └─ endpoints/
│     │     ├─ summoner.ts       召唤师：current / byName / byPuuid / profile / icon
│     │     ├─ match-history.ts  战绩：matches / gameDetail
│     │     ├─ ranked.ts         段位：ranked-stats
│     │     ├─ gameflow.ts       对局流程：phase / session / ready-check / spectate …
│     │     ├─ champ-select.ts   选人：session / pick / ban / swap / trade / runes
│     │     ├─ lobby.ts          房间：自定义训练房 / 成员
│     │     ├─ chat.ts           聊天：me / status / conversations / friends
│     │     ├─ profile.ts        个性化：背景 / 段位展示 / 勋章 / 头像框
│     │     ├─ game-data.ts      静态数据：champions / items / spells / runes / icons
│     │     └─ live-client.ts    游戏内 Live Client Data API（阶段 5）
│     ├─ tests/
│     │  ├─ helpers/
│     │  │  ├─ mock-lcu-server.ts  本地 mock LCU（HTTP + WebSocket）
│     │  │  └─ cmdline-fixtures.ts  进程命令行夹具
│     │  └─ *.test.ts
│     ├─ scripts/clean.mjs
│     ├─ package.json
│     ├─ tsconfig.json / tsconfig.build.json / tsconfig.bundle.json
│     ├─ rollup.config.mjs
│     └─ README.md
```

遵循仓库 `docs/package-template.md` 的全部约定：`UNLICENSED`、ESM+CJS+`.d.ts`、`files` 只发 `dist` + README、`sideEffects: false`、`engines.node >=20`、vitest 测试。

## 5. 核心接口设计

### 5.1 门面与生命周期

```ts
import { createLolClient } from "@sakurachiyo0v0/lol";

// 自动发现本机 LCU 并连接；未发现/未启动时抛 CLIENT_NOT_RUNNING
const client = await createLolClient();

// 也可显式指定连接（测试、多客户端场景）
const client2 = await createLolClient({
  connection: { port: 12345, token: "xxx", server: "HN1" },
});

await client.close(); // 关闭 REST 会话与 WebSocket；需要重连时重新调用 createLolClient()
```

### 5.2 领域模块（全部挂在 client 下）

```ts
client.summoner.getCurrent();                    // 当前召唤师
client.summoner.getByName("召唤师名");            // 按名字搜索
client.summoner.getByPuuid(puuid);               // 按 PUUID
client.matchHistory.getMatches(puuid, { begIndex: 0, endIndex: 19 });
client.matchHistory.getGameDetail(gameId);
client.ranked.getStats(puuid);
client.gameflow.getPhase();                      // 'None'|'Lobby'|'Matchmaking'|'ReadyCheck'|'ChampSelect'|'InGame'|'EndOfGame'…
client.gameflow.acceptReadyCheck();
client.gameflow.dodge();
client.gameflow.spectate(summonerName);
client.champSelect.getSession();
client.champSelect.pick(actionId, championId);
client.champSelect.ban(actionId, championId);
client.champSelect.acceptTrade(id);
client.lobby.create5v5PracticeLobby({ name, password });
client.chat.getMe();  client.chat.setStatus("...");
client.profile.setBackground(skinId);  client.profile.setRankShown(queue, tier, division);
client.gameData.getChampions();        // 静态数据
```

### 5.3 事件订阅（WebSocket）

```ts
client.events.onGameflowPhase((phase) => ...);
client.events.onChampSelect((session) => ...);
client.events.onCurrentSummoner((summoner) => ...);
client.events.subscribe("OnJsonApiEvent_lol-gameflow_v1_gameflow-phase", handler); // 通用订阅
client.events.off(...) / 返回取消函数
```

### 5.4 数据模型约定

端点返回的 raw LCU JSON **保持原样透传**（Seraphine 也是这么做的），TypeScript 类型只做描述不做强制清洗；可选的高层解析（KDA、对局摘要、按模式过滤）放到后续阶段的 `parsers/`，默认不污染底层 API。

## 6. 能力清单与阶段划分

| 阶段 | 内容 | 关键端点 | 风险 |
| --- | --- | --- | --- |
| **P0 基础设施** | 包骨架、discovery、transport、events、errors/types、mock LCU server | 进程发现 + `wss://127.0.0.1` | 无 |
| **P1 核心查询** | summoner、match-history、ranked、game-data | `/lol-summoner/v1`、`/lol-match-history/v1`、`/lol-ranked/v1`、`/lol-game-data/assets/v1` | 无 |
| **P2 对局感知** | gameflow 全接口 + 事件订阅完善 | `/lol-gameflow/v1`、`/lol-matchmaking/v1`、`/lol-spectator/v1` | 无 |
| **P3 选人操作** | champ-select、lobby | `/lol-champ-select/v1`、`/lol-lobby/v2` | 低（自动操作类，需披露） |
| **P4 个性化** | profile、chat | `/lol-chat/v1`、`/lol-summoner/v1/current-summoner/summoner-profile`、`/lol-regalia/v2` | 低 |
| **P5 进阶** | live-client-data（端口 2999）、parsers、自动 B/P 高层编排 | `/liveclientdata/*` | 自动 B/P 有封号风险，文档显著披露 |

**v0.1.0 首发 = P0 + P1 + P2**。P3 之后的阶段按需求与反馈决定优先级。

### 能力总览（超出 Seraphine 的部分）

除 Seraphine 已验证的端点外，本 SDK 计划覆盖的官方 LCU 接口还包括：

- `/lol-career-stats/v1/*` — 生涯统计（英雄场次/胜率随时间曲线）
- `/lol-collections/v1/inventories/*` — 收藏（拥有的英雄/皮肤/炫彩）
- `/lol-login/v1/session` — 登录会话信息
- `/lol-matchmaking/v1/search` — 匹配队列状态
- `/lol-champ-select/v1/session/my-selection` — 我的选人状态
- `/lol-perks/v1/pages`、`/lol-perks/v1/currentpage` — 符文页管理
- `/riotclient/*` — 客户端进程控制（kill-and-restart-ux、ux-state、region/locale）
- Live Client Data API（游戏内，端口 2999，无认证）：`/liveclientdata/allgamedata`、`/liveclientdata/playerlist`、`/liveclientdata/eventdata`

## 7. 关键机制

### 7.1 进程发现（discovery）

1. 用 `tasklist /FI "imagename eq LeagueClientUx.exe" /NH`（或备选路径）拿到 `LeagueClientUx.exe` 的 PID；多客户端时取第一个或让调用方指定 PID。
2. 用 PowerShell `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` 读 `CommandLine`（wmic 已被 Win11 移除，PowerShell CIM 兼容 Win10/11；不引入原生依赖）。
3. 从命令行解析 `--app-port=`、`--remoting-auth-token=`、`--rso_platform_id=`；后两者缺失（国际服客户端参数不同）时按「无 SGP、仅 LCU」处理。
4. 输出 `{ pid, port, token, server }`。

发现失败（客户端未运行/权限不足）→ `LolError`，错误码 `CLIENT_NOT_RUNNING` / `DISCOVERY_FAILED`，并给出可读提示。

### 7.2 传输层（http-transport）

- **REST**：`undici`（Node 20 内置 fetch 底层）自建 `Agent`，`connect: { rejectUnauthorized: false }`（LCU 自签名证书）；`Authorization: Basic riot:<token>`；JSON 请求/响应。
- **限流**：全局信号量（默认并发 8，可配置）——LCU「一碰就碎」，这是 Seraphine 验证过的稳定性手段。
- **重试**：幂等 `GET` 默认重试 3 次、指数退避（500ms 起）；`POST/PUT/DELETE` 默认不重试（防副作用重复）。`404`/`NOT_FOUND` 类错误不重试直接抛。
- **WebSocket**：`ws` 包连接 `wss://127.0.0.1:{port}/`，`[5, "OnJsonApiEvent_<endpoint>"]` 订阅；收到 `[8, "OnJsonApiEvent_...", data]` 后按 `uri` + `eventType` 路由到注册的回调；断线自动重连（指数退避，上限 5 次后抛 `CONNECTION`）。

### 7.3 腾讯 SGP 通道（国服）

检测到 `server` 属于腾讯平台（`HN1`/`HN10`/`BGP2`/`NJ100`/`GZ100`/`CQ100`/`TJ100`/`TJ101`）时：

1. 从 `/entitlements/v1/token` 取 `accessToken`（同时可订阅该端点事件保持刷新）；
2. 建第二个会话 `https://{server}-sgp.lol.qq.com:21019`，`Authorization: Bearer <token>`；
3. 战绩/段位查询（`/match-history-query/...`、`/leagues-ledge/...`）与观战（`/gsm/v1/ledge/spectator/...`）走 SGP；海外服没有此通道，查询回退 LCU 原生端点。

### 7.4 事件订阅（events）

注册表维护 `endpoint → Set<handler>`。WebSocket 在 `createLolClient()` 连接时建立，**内置订阅四个核心事件**：`current-summoner`、`gameflow-phase`、`champ-select`、`entitlements-token`（与 Seraphine 同策略，避免错过早期状态变更）；`events.subscribe()` 在已建立的连接上追加订阅。所有回调以「原始事件对象 `{ uri, eventType, data }`」入参，命名订阅（`onGameflowPhase` 等）是它的薄封装。

## 8. 错误处理

统一 `LolError`，构造 `{ code, message, cause? }`，错误消息与日志**脱敏**（不输出 token、端口命令行原文）：

| 错误码 | 场景 |
| --- | --- |
| `CLIENT_NOT_RUNNING` | 未发现 LeagueClientUx 进程 |
| `DISCOVERY_FAILED` | 找到进程但读不到 port/token |
| `CONNECTION` | REST/WS 连接失败、断线超限 |
| `NOT_FOUND` | 召唤师/战绩/对局不存在（对应 Seraphine 的 SummonerNotFound 等） |
| `RATE_LIMIT` | LCU 429 / 限流 |
| `AUTH` | token 失效 |
| `TIMEOUT` | 请求超时 |
| `UNKNOWN` | 其他 |

## 9. 测试策略（真实协议路径优先）

- **mock-lcu-server**（`tests/helpers/`）：用 Node 原生 `http` + `ws` 起一个本地假 LCU——暴露 `--app-port` 同款端口，提供若干查询端点、`/entitlements/v1/token` 与 WebSocket 事件广播。测试通过真实 HTTP/WS 协议调用，验证：认证头、JSON 编解码、错误归类、重试、限流、事件订阅路由、断线重连。
- **discovery 单测**：用命令行字符串夹具 + 注入的「读进程函数」替换真实 PowerShell 调用，验证解析逻辑。
- **SGP 单测**：mock SGP 端口，验证 Bearer 头、server 白名单判断。
- **真实客户端集成测试**：`it.skipIf` 标注，仅在设置了 `LOL_E2E=1` 且本机有客户端时运行（不纳入 CI）。
- 校验与生命周期测试：`createLolClient` 参数校验、`close()` 幂等。

## 10. 文档与验证

- `README.md`：环境要求（Windows + 本机客户端 + Node 20）、安装方式（workspace / git 子目录，含 pnpm `allowBuilds` 授权）、最小示例、参数表、错误码表、**风险与合规声明**（LCU 政策链接、封号风险、只读接口与自动操作接口的分级说明）、验证命令。
- 更新 `docs/packages-index.md`（总览表 + 包详情）。
- 根 `package.json` 的 `build` 脚本追加 `pnpm --filter @sakurachiyo0v0/lol build`。
- 验证命令：`pnpm --filter @sakurachiyo0v0/lol typecheck && pnpm --filter @sakurachiyo0v0/lol test && pnpm --filter @sakurachiyo0v0/lol build`。

## 11. 合规与风险

1. SDK 完全基于 Riot 公开的 LCU API，不含对客户端文件/内存的读取或修改（参考《英雄联盟》游戏插件公约）。
2. **封号风险披露**：只读查询（P1/P2）风险极低；自动操作类（P3 自动选禁、P5 自动 B/P 编排）属灰色地带，README 显著标注「不保证不封号」，调用方自担风险。
3. **不保存凭据**：port/token 每次从进程命令行实时获取，仅在进程内使用；错误日志脱敏。
4. 与 Seraphine 的关系：仅参考设计思路与公开 API 事实，无代码复制；本 SDK 许可证不受 Seraphine GPLv3 约束。
5. Riot 免责声明（README 引用 Riot 官方声明原文）。

## 12. 里程碑

| 里程碑 | 范围 | 验收 |
| --- | --- | --- |
| M1 | P0 基础设施 | mock 测试全绿；可连真实客户端并打印 gameflow-phase 事件（人工验证） |
| M2 | P1 核心查询 | 可查当前召唤师、战绩列表、对局详情、段位；game-data 图标下载 |
| M3 | P2 对局感知 | phase/session/ready-check/spectate 全接口 + 事件订阅完善 |
| M4+ | P3–P5 | 按需求推进，每个阶段独立验收 |
