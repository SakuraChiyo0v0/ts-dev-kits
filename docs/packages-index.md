# ts-dev-kits 依赖包索引

本文件是仓库内所有可复用依赖包的总索引。维护原则：

- 新增一个依赖包时，在「总览」表格追加一行，并按照下文格式补一段「包详情」。
- 新建包的目录结构约定见 [`package-template.md`](package-template.md)。
- 表格中的「引用方式」列填写最常用的安装方式；完整选项见对应包的详情。
- 所有 `@sakurachiyo0v0/*` 包也发布到 GitHub Packages(私有 npm 仓库),外部项目配置一次 `.npmrc` 后即可 `pnpm add @sakurachiyo0v0/<name>` 直接安装 —— 见 [`GITHUB_PACKAGES.md`](GITHUB_PACKAGES.md)。

## 总览

| 包名 | 版本 | 用途 | 状态 | 引用方式 |
| --- | --- | --- | --- | --- |
| `@sakurachiyo0v0/email` | 0.1.0 | 与供应商解耦的 Node.js 邮件 SDK | 可用（SMTP 适配器） | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/email` |
| `@sakurachiyo0v0/ffmpeg` | 0.1.0 | FFmpeg/ffprobe 进程封装 + 媒体处理高层函数 | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/ffmpeg` |
| `@sakurachiyo0v0/bilibili` | 0.2.1 | B 站 SDK:视频下载(解析/取流/下载/ffmpeg 合并)+ 平台控制(收藏夹/关注/分组/互动/动态/稍后再看/历史) | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/bilibili` |
| `@sakurachiyo0v0/chat-platforms` | 0.1.0 | 统一聊天平台接入 SDK(消息模型/适配器注册表,当前飞书) | 可用(飞书, websocket/webhook) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/chat-platforms` |
| `@sakurachiyo0v0/lol` | 0.1.1 | 英雄联盟 LCU 本地能力 SDK(召唤师/战绩/段位/对局流程/游戏数据/事件) | 可用(查询+对局感知, 国服 SGP) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/lol` |
| `@sakurachiyo0v0/account` | 0.2.0 | 跨平台账号认证底座(登录态存储/扫码+密码登录骨架/错误模型) | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/account` |
| `@sakurachiyo0v0/netease-music` | 0.1.0 | 网易云音乐下载 SDK(weapi 加密/二维码登录/权限感知品质/试听拦截) | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/netease-music` |
| `@sakurachiyo0v0/booth` | 0.1.0 | BOOTH(booth.pm)领取/购买 SDK:登录态管理/商品解析/免费领取/付费下单/文件下载 | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/booth` |
| `@sakurachiyo0v0/vrchat` | 0.2.1 | VRChat 官方 REST API SDK(认证/用户/世界/头像/实例/好友/通知/收藏/群组/文件/权限/系统/经济/审核) | 可用(全功能覆盖) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/vrchat` |
| `@sakurachiyo0v0/steam` | 0.5.1 | Steam SDK(查询向):Web API/Storefront/Community 三套接口,登录态支持,写操作仅激活码兑换一项 | 可用(全阶段交付) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/steam` |
| `@sakurachiyo0v0/xiaoheihe` | 0.1.0 | 小黑盒 SDK:扫码登录 + hkey/nonce 签名 + 只读查询(帖子/评论/feed/@消息/用户) | 可用(P0 只读) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/xiaoheihe` |
| `@sakurachiyo0v0/dsh-sdk-tools` | 0.2.0 | DSH host 插件:把 bilibili/netease-music/ffmpeg/email/lol/vrchat 包装成 agent 工具,经 Agent 预设按需暴露 | 可用 | `pnpm add @sakurachiyo0v0/dsh-sdk-tools`(GitHub Packages) |

## 包详情

### `@sakurachiyo0v0/email`

邮件发送 SDK。公共接口与具体邮件服务商解耦：调用方只面对 `EmailClient` 与统一消息类型，当前内置 SMTP 适配器，未来可无破坏地增加 Resend、SendGrid、AWS SES 等适配器。

**适用环境：** Node.js 20+，运行在可信任的服务端进程；不要在浏览器或 WebView 中保存 SMTP 密码。

**核心接口：**

- `createEmailClient({ provider })` — 创建客户端
- `smtpProvider({ host, port, secure, auth?, ... })` — 创建 SMTP 适配器
- `client.verify()` — 连接与认证检查，不发送邮件
- `client.send(message)` — 发送邮件，只尝试一次，不自动重试
- `client.close()` — 释放底层连接资源
- `EmailError` — 统一错误类型，错误码 `CONFIGURATION` / `VALIDATION` / `AUTHENTICATION` / `CONNECTION` / `DELIVERY` / `UNKNOWN`

**消息能力：** `to` / `cc` / `bcc` / `replyTo` 收件人；`text` / `html` 正文（至少一种）；附件（文件路径、`Buffer` 或 `Readable`）；自定义邮件头。SDK 在发送前做输入校验（含防 CRLF 头注入），并对错误消息中的 SMTP 用户名 / 密码脱敏。

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/email@workspace:*
```

从私有 GitHub monorepo 安装（需先在消费项目 `pnpm-workspace.yaml` 中授权构建脚本，见包内 README）：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/email"
```

生产项目建议固定到已审核提交：

```json
{
  "dependencies": {
    "@sakurachiyo0v0/email": "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#<commit-sha>&path:/packages/email"
  }
}
```

**API 示例：**

```ts
import { createEmailClient, smtpProvider } from "@sakurachiyo0v0/email";

const client = createEmailClient({
  provider: smtpProvider({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASSWORD!,
    },
  }),
});

await client.verify();
const result = await client.send({
  from: process.env.SMTP_FROM!,
  to: ["alice@example.com"],
  subject: "SDK 测试邮件",
  text: "纯文本内容",
});
await client.close();
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/email test   # 单测（本地 SMTP 协议路径）
pnpm --filter @sakurachiyo0v0/email build  # 构建 ESM + CJS + d.ts
pnpm verify:email-package           # pnpm pack 后从临时消费项目导入
pnpm verify:email-git-package       # 以 git 子目录依赖方式安装并导入
```

**更多细节：** [`packages/email/README.md`](../packages/email/README.md)

### `@sakurachiyo0v0/ffmpeg`

FFmpeg/ffprobe 进程封装 SDK。底层提供任意参数的运行器与原生命令输入,上层提供视频/音频/图片常用处理函数,适合服务端音视频处理场景。

**适用环境：** Node.js 20+,系统需已安装 `ffmpeg` 与 `ffprobe`(或创建客户端时显式传入二进制路径)。

**核心接口：**

- `createFfmpegClient({ ffmpegPath?, ffprobePath? })` — 创建客户端
- `client.run(args, options?)` / `client.runFfprobe(args, options?)` — 任意参数运行,支持超时、stdin 输入、进度回调
- `client.runCommand(command)` — 原生命令字符串输入,任何 ffmpeg 功能都能用(兜底)
- `client.probe(input)` — 用 ffprobe 读取媒体元数据
- 视频:`transcode`、`cut`、`concat`、`watermark`、`loopVideo`、`toGif`、`extractFrame`、`thumbnail`
- 音频:`extractAudio`、`convertAudio`、`toMp3` / `toFlac` / `toWav` / `toOgg` / `toM4a`、`setVolume`、`normalizeAudio`、`joinAudio`
- 图片:`resizeImage`、`cropImage`、`convertImage`、`compositeImage`、`compressImage`
- `FfmpegError` — 统一错误类型,错误码 `CONFIGURATION` / `NOT_FOUND` / `INVALID_INPUT` / `TIMEOUT` / `CANCELLED` / `PROCESS_ERROR` / `UNKNOWN`

**进度支持：** 高层函数默认带 `-progress pipe:1`,通过 `onProgress` 回调拿到 `frame`、`outTime`、`percent`(需提供 `progressTotalMs`)等进度快照。

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/ffmpeg@workspace:*
```

从私有 GitHub monorepo 安装(需先在消费项目 `pnpm-workspace.yaml` 中授权构建脚本,见包内 README)：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/ffmpeg"
```

**API 示例：**

```ts
import { createFfmpegClient } from "@sakurachiyo0v0/ffmpeg";

const ffmpeg = createFfmpegClient();
const info = await ffmpeg.probe("input.mp4");
await ffmpeg.transcode({
  input: "input.mp4",
  output: "output.webm",
  videoCodec: "libvpx",
  progressTotalMs: info.duration * 1000,
  onProgress: (p) => console.log(p.percent),
});
await ffmpeg.thumbnail({ input: "input.mp4", output: "thumb.jpg" });
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/ffmpeg test   # 单测(真实 ffmpeg 生成视频 + 转码/截图/音频)
pnpm --filter @sakurachiyo0v0/ffmpeg build  # 构建 ESM + CJS + d.ts
```

**更多细节：** [`packages/ffmpeg/README.md`](../packages/ffmpeg/README.md)

### `@sakurachiyo0v0/bilibili`

B 站视频下载 SDK。解析视频信息、获取播放流、可配置下载器下载,并用 `@sakurachiyo0v0/ffmpeg` 合并音视频。核心逻辑参考开源项目 [Bili23-Downloader](https://github.com/ScottSloan/Bili23-Downloader)。

**适用环境：** Node.js 20+,下载合并视频需系统安装 `ffmpeg`。

**核心接口：**

- `createBilibiliClient({ cookie?, authPath?, download?, merge? })` — 创建客户端;未传 cookie 时自动从登录态存储加载(`authPath` 复用 `@sakurachiyo0v0/account` 底座,默认 `<配置根>/amechan/bilibili/auth.json`)
- `client.parse(url)` — 解析 B 站链接,返回 `MediaItem[]`(投稿视频/番剧/课程/音乐/空间/收藏夹/合集/每周必看/稍后再看/历史记录)
- `client.getStreams(item, { quality?, codec? })` — 获取 DASH/MP4 播放流,支持清晰度与编码选择
- `client.download(item, { outputDir, quality?, onProgress? })` — 下载并合并,返回文件路径
- `client.fav` — 收藏夹管理:创建/重命名/删除收藏夹、收藏/取消收藏视频、内容复制/移动/批量删除/清空失效、收藏夹列表/元数据/内容明细
- `client.relation` — 关注关系:关注/取关/批量关注/拉黑、关注/粉丝列表、关系统计、批量关系查询
- `client.tag` — 关注分组:分组列表/明细、创建/重命名/删除分组、用户加入/移出/复制/移动分组
- `client.interaction` — 视频互动(只读):点赞状态查询
- `client.comment` — 评论:列表/发表/回复/删除/置顶
- `client.danmaku` — 弹幕:发送(自动 WBI 签名)/获取列表
- `client.dynamic` — 动态:发布纯文本/删除/转发/置顶
- `client.data` — 个人数据:稍后再看(列表/添加/删除/清空)、历史记录(列表/删除/清空/停用开关)
- `bilibiliQrAdapter()` — B 站扫码登录适配器(`QrLoginAdapter` 实现,复用 `@sakurachiyo0v0/account` 的扫码骨架/存储/续期)
- 下载器可配置:并发数/分块大小/重试/限速/断点续传/CDN 过滤
- `BilibiliError` — 统一错误码:`NETWORK` / `API_ERROR` / `INVALID_URL` / `LOGIN_REQUIRED` / `AUTH_EXPIRED` / `DOWNLOAD_FAILED` / `MERGE_FAILED` / `UNSUPPORTED_TYPE`

**平台控制 API 需登录**(自动注入 csrf 并复用登录态续期),协议对照 [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect);完整能力清单见 [`docs/superpowers/specs/2026-08-23-bilibili-control-apis-design.md`](../superpowers/specs/2026-08-23-bilibili-control-apis-design.md)。点赞/投币/三连(视频)、评论点赞/点踩、动态点赞等刷量重灾区写操作因违反官方规则未提供。

**WBI 签名内置**,自动处理 img_key/sub_key 获取与签名;高画质需登录。扫码登录内聚于本包:`bilibiliQrAdapter()` 配合 account 的 `qrcodeLogin`(本地窗口 + 浏览器弹窗 + 自动落盘),登录态失效时自动 `refresh` 续期。兼容旧版独立登录包(bilibili-auth)留下的老格式 auth.json,首次读取自动迁移为新格式。

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/bilibili@workspace:*
```

从私有 GitHub monorepo 安装(需授权 `@sakurachiyo0v0/bilibili` 与 `@sakurachiyo0v0/ffmpeg` 两个构建脚本)：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/bilibili"
```

**API 示例：**

```ts
import { createBilibiliClient } from "@sakurachiyo0v0/bilibili";
const bili = createBilibiliClient({ download: { concurrency: 4 } });
const items = await bili.parse("https://www.bilibili.com/video/BV1xx411c7mD");
await bili.download(items[0]!, { outputDir: "./downloads", quality: 80 });
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/bilibili test   # mock API 验证解析/取流/WBI/下载/清晰度选择
pnpm --filter @sakurachiyo0v0/bilibili build  # 构建 ESM + CJS + d.ts
```

**更多细节：** [`packages/bilibili/README.md`](../packages/bilibili/README.md)

### `@sakurachiyo0v0/chat-platforms`

统一聊天平台接入 SDK。平台差异在适配器内消化，上层只面对统一消息模型（`ChatSource` / `ChatMessage` / `ChatMessageOutbound`），通过注册表 + 工厂新增平台零改核心。架构参考 AstrBot 与 hermes-agent 的平台适配体系。第一版内置**飞书**适配器（长连接/WebSocket 与 webhook 两种事件接收方式）。

**适用环境：** Node.js 20+，运行在可信任的服务端进程（含 Electron 主进程）；不要在浏览器/WebView 中保存应用凭证。

**核心接口：**

- `ChatPlatformClient` — 多平台客户端：`add(adapter, policy?)` / `remove(name)` / `send(source, message)` / `onMessage(handler)` / `onBlocked(handler)` / `disconnectAll()`；支持注入响应策略
- `ChatPlatformAdapter` — 适配器统一接口：`connect({ onMessage })` / `disconnect()` / `send(source, message)` / `handleWebhook?(body)` / `react?(message, emoji)`
- `ChatPlatformRegistry` / `registerPlatform()` — 注册表 + 工厂
- `ChatResponsePolicy` / `defaultPolicy()` / `PolicyChecker` — 消息响应策略（白名单/黑名单/唤醒词/关键词屏蔽/限流/表情回应），参考 AstrBot `platform_settings`
- `feishuProvider(config)` — 飞书适配器工厂；`registerFeishuPlatform()` 注册到默认注册表
- `ChatPlatformError` — 统一错误码：`CONFIGURATION` / `VALIDATION` / `AUTHENTICATION` / `CONNECTION` / `DELIVERY` / `NOT_FOUND` / `UNKNOWN`

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/chat-platforms@workspace:*
```

从私有 GitHub monorepo 安装（需授权 `@sakurachiyo0v0/chat-platforms` 与 `@larksuiteoapi/node-sdk` 构建脚本）：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/chat-platforms"
```

**API 示例：**

```ts
import { ChatPlatformClient, feishuProvider } from "@sakurachiyo0v0/chat-platforms";

const client = new ChatPlatformClient();
client.onMessage(async (message) => {
  await client.send(message.source, { text: "收到：" + message.text });
});

await client.add(
  feishuProvider({
    appId: process.env.FEISHU_APP_ID!,
    appSecret: process.env.FEISHU_APP_SECRET!,
    transport: "websocket",
  }),
);
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/chat-platforms test   # 单测（注册表/客户端/飞书事件解析/webhook challenge）
pnpm --filter @sakurachiyo0v0/chat-platforms build  # 构建 ESM + CJS + d.ts
```

**更多细节：** [`packages/chat-platforms/README.md`](../packages/chat-platforms/README.md)

### `@sakurachiyo0v0/lol`

英雄联盟（LoL）客户端本地能力 SDK。封装 LCU API（League Client Update，客户端暴露的本机 HTTP/WebSocket 接口），提供召唤师、战绩、段位、对局流程、选人、游戏数据等能力，供本机 Node 进程（Electron 主进程 / CLI / 本地 Web 后端）直接使用。代码完全自研（无 Seraphine 代码复制，规避 GPLv3），参考 LCU 官方文档与开源项目 [Seraphine](https://github.com/Zzaphkiel/Seraphine) 的设计思路。

**适用环境：** Node.js 20+，Windows 本机 + 运行中的英雄联盟客户端；LCU 只存在于本机客户端运行期间，**不能做成云端 SaaS**。

**核心接口：**

- `createLolClient({ connection?, concurrency?, timeoutMs? })` — 自动发现本机 LCU 并连接（也可显式指定连接参数）
- `client.summoner` — `getCurrent()` / `getByName()` / `getByPuuid()` / `getProfile()`
- `client.matchHistory` — `getMatches(puuid, {begIndex, endIndex})` / `getMatchesViaSgp()` / `getGameDetail(gameId)`
- `client.ranked` — `getStats(puuid)` / `getStatsViaSgp(puuid)`
- `client.gameflow` — `getPhase()` / `getSession()` / `getReadyCheck()` / `acceptReadyCheck()` / `dodge()` / `reconnect()` / `playAgain()` / `spectate()`
- `client.champSelect` — 选人操作：`pick()` / `ban()` / `completeAction()` / `acceptTrade()` / `acceptSwap()` / `benchSwap()` / `reroll()` / `selectConfig()` / 符文页管理（⚠️ 自动操作类，低风险需披露）
- `client.lobby` — `create5v5PracticeLobby()` / `getLobby()` / `playAgain()`
- `client.profile` — 生涯设置：`setBackground()` / `setProfileIcon()` / `setRankShown()` / `removeTokens()` / `removePrestigeCrest()`
- `client.chat` — 聊天社交：`getMe()` / `setStatus()` / `setAvailability()` / `getConversations()` / `sendMessage()` / `sendFriendRequest()` / `sendNotification()`
- `client.gameData` — 静态数据（英雄/物品/符文/召唤师技能/队列）与 `fetchAsset()` 资源获取
- `client.events` — WebSocket 事件订阅：`onGameflowPhase` / `onChampSelect` / `onCurrentSummoner` / `onSgpToken` / 通用 `subscribe()`
- `client.liveClient` — 游戏内实时数据（端口 2999，明文只读）：`getAllGameData()` / `getPlayerList()` / `getActivePlayer()` / `getEventData()` 等；独立工厂 `createLiveClient()`
- `parsers` — 纯函数解析层：`parseMatchSummary` / `parseMatchesSummary` / `getRecentChampions` / `getTeammates` / `parseRankSummary`（LCU）/ `parseRankSummaryFromSgp` / `formatDuration` / `formatTimestamp`
- `client.sgp` — 腾讯国服 SGP 通道（检测到国服服务器自动启用，非国服为 `undefined`）
- `client.championNames` — 英雄名映射（id → 中文名）：内置全量表离线可用，运行时自动从 CommunityDragon latest 通道更新（出新英雄自动生效），不依赖 LCU 连接；独立类 `ChampionNamesService`（可自定义数据源/缓存 TTL）
- `LolError` — 统一错误码 `CLIENT_NOT_RUNNING` / `DISCOVERY_FAILED` / `CONNECTION` / `NOT_FOUND` / `RATE_LIMIT` / `AUTH` / `TIMEOUT` / `UNKNOWN`，消息脱敏

**关键机制：** tasklist + PowerShell CIM 进程发现；undici 忽略自签名证书 + BasicAuth；信号量限流 + GET 指数退避重试；WebSocket 断线自动重连；国服 SGP Bearer 通道。

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/lol@workspace:*
```

从私有 GitHub monorepo 安装（需在消费项目 `pnpm-workspace.yaml` 中授权 `@sakurachiyo0v0/lol` 构建脚本）：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/lol"
```

**API 示例：**

```ts
import { createLolClient } from "@sakurachiyo0v0/lol";

const client = await createLolClient();
const me = await client.summoner.getCurrent();
const games = await client.matchHistory.getMatches(me.puuid, { begIndex: 0, endIndex: 19 });
client.events.onGameflowPhase((phase) => console.log("阶段:", phase));
await client.close();
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/lol typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/lol test        # 单测（本地 mock LCU 服务器，走真实 HTTP/WS 协议路径）
pnpm --filter @sakurachiyo0v0/lol build       # 构建 ESM + CJS + d.ts
```

**更多细节：** [`packages/lol/README.md`](../packages/lol/README.md)；设计文档 [`docs/superpowers/specs/2026-08-22-lol-sdk-design.md`](superpowers/specs/2026-08-22-lol-sdk-design.md)

### `@sakurachiyo0v0/account`

跨平台账号认证底座(薄):登录态存储、扫码登录骨架、密码登录骨架与公共错误模型。**不感知具体平台**——网易云、B 站、酷狗、QQ 音乐等平台的登录差异收敛在各自的 `QrLoginAdapter` / `PasswordLoginAdapter` 实现里,登录流程、存储、CLI 全复用。设计文档 [`docs/superpowers/specs/2026-08-23-netease-music-sdk-design.md`](superpowers/specs/2026-08-23-netease-music-sdk-design.md)。

**适用环境:** Node.js 20+，桌面环境（需要打开浏览器）；无头环境可用 `autoOpenBrowser: false`。

**核心接口：**

- `AuthStore` — 跨平台登录态存储：`new AuthStore({ platform, path? })`，默认 `<配置根>/amechan/<platform>/auth.json`，原子写 + 600 权限；`save()` / `load()` / `loadSync()` / `clear()` / `exists()`
- `qrcodeLogin({ adapter, store?, ... })` — 扫码登录骨架：本地窗口 + 系统浏览器弹二维码 → 手机 App 扫码 → 轮询确认 → 收集凭证 → 可选持久化；返回 `{ credentials, saved }`
- `QrLoginAdapter` — 扫码平台适配器契约：`generateKey()` / `pollStatus()` / `refresh?()` / `serialize()` / `deserialize()`；扫码平台接入 = 实现这 5 个方法
- `passwordLogin({ adapter, username, password, onNeedCode?, store?, ... })` — 密码登录骨架：提交用户名密码 → 若需 2FA 循环取码验证 → 成功可选持久化；2FA 交互经 `onNeedCode` 回调
- `PasswordLoginAdapter` — 密码平台适配器契约：`login()` / `verifyCode()` / `refresh?()` / `serialize()` / `deserialize()`；密码平台（如 VRChat）接入 = 实现这 5 个方法
- `resolveConfigRoot()` / `defaultAuthPath(platform)` — 配置目录解析（Windows `%APPDATA%` / macOS `~/Library/Application Support` / Linux `$XDG_CONFIG_HOME`，支持 `AMECHAN_CONFIG_HOME` 覆盖）
- `AccountError` — 错误码 `NETWORK` / `API_ERROR` / `AUTH_EXPIRED` / `LOGIN_REQUIRED` / `UNKNOWN` / `INVALID_CREDENTIALS` / `TWO_FACTOR_REQUIRED` / `TWO_FACTOR_FAILED`

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/account@workspace:*
```

从私有 GitHub monorepo 安装：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/account"
```

**API 示例：**

```ts
import { AuthStore, qrcodeLogin } from "@sakurachiyo0v0/account";
import { neteaseQrAdapter } from "@sakurachiyo0v0/netease-music";

const store = new AuthStore({ platform: "netease-music" });
const { credentials, saved } = await qrcodeLogin({ adapter: neteaseQrAdapter(), store });
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/account test        # 单测（存储/扫码骨架状态机/错误模型）
pnpm --filter @sakurachiyo0v0/account build       # 构建 ESM + CJS + d.ts
```

**更多细节：** [`packages/account/README.md`](../packages/account/README.md)

### `@sakurachiyo0v0/netease-music`

网易云音乐下载 SDK：自研 weapi 加密通道（两层 AES-CBC + RSA）、二维码登录（基于 `@sakurachiyo0v0/account`）、**权限感知的品质选择**与**试听拦截（硬规则）**的合规下载。支持单曲/歌单/专辑、歌词（LRC）、封面与 ID3 标签。设计文档 [`docs/superpowers/specs/2026-08-23-netease-music-sdk-design.md`](superpowers/specs/2026-08-23-netease-music-sdk-design.md)。

**适用环境：** Node.js 20+；ID3 标签写入需系统安装 `ffmpeg`（通过 `@sakurachiyo0v0/ffmpeg`）。

**合规红线（用户明确要求）：**

- 不涉及任何"非 VIP 下载到 VIP 歌曲"的违规行为；取流由服务端按账号身份裁决，SDK 不绕过、不伪装会员；
- **试听 = 拒绝**：取流响应出现 `freeTrialInfo` 或时长明显短于完整歌曲 → 抛 `TRIAL_ONLY`，绝不落盘不完整音频；
- 品质与身份匹配：下载前用 `song/privilege` + `vip/info` 计算"该账号实际可请求的品质清单"，目标品质不在清单内 → 抛 `PRIVILEGE_DENIED`（严格模式，不降级不绕行）。

**核心接口：**

- `createNeteaseClient({ cookie?, authPath?, download?, baseUrl?, fetchImpl? })` — 创建客户端；未传 cookie 时自动从 account AuthStore 加载
- `client.parse(url)` — 解析歌曲/歌单/专辑链接 → `{ items, songs }`（歌单/专辑展开为歌曲清单）
- `client.getSongInfo(id)` / `client.getVipInfo()` / `client.getAvailableLevels(id)` — 详情 / VIP 信息 / 权限品质清单
- `client.download(item, { outputDir?, level?, lyric?, lyricMode?, cover?, writeTags?, onProgress? })` — 下载（权限预检 + 试听拦截强制），返回 `{ filePath, level, lyricPath?, coverPath? }`
- `client.downloadByInput(input)` — 按链接或歌曲 ID 便捷下载
- `neteaseQrAdapter()` — 网易云二维码登录适配器（供 `qrcodeLogin` 使用）
- 品质等级：`standard`(128k) / `higher`(192k) / `exhigh`(320k) / `lossless`(FLAC) / `hires`
- `NeteaseError` — 错误码 `NETWORK` / `API_ERROR` / `NOT_FOUND` / `INVALID_URL` / `LOGIN_REQUIRED` / `AUTH_EXPIRED` / `PRIVILEGE_DENIED` / `TRIAL_ONLY` / `DOWNLOAD_FAILED` / `UNKNOWN`

**CLI：** `amechan-netease login|status|logout|parse|download`（选项 `--auth-path` / `--no-browser` / `--level` / `--output-dir` / `--no-lyric` / `--no-cover` / `--lyric-mode`）。

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/netease-music@workspace:*
```

从私有 GitHub monorepo 安装（需授权 `@sakurachiyo0v0/netease-music`、`@sakurachiyo0v0/account`、`@sakurachiyo0v0/ffmpeg` 构建脚本）：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/netease-music"
```

**API 示例：**

```ts
import { createNeteaseClient } from "@sakurachiyo0v0/netease-music";

const client = createNeteaseClient({ authPath: "path/to/auth.json" });
const { songs } = await client.parse("https://music.163.com/song?id=123456");
await client.download(songs[0]!, { outputDir: "./downloads", level: "exhigh" });
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/netease-music test        # 单测（本地 mock 接口：weapi/解析/权限/试听拦截/下载链路）
pnpm --filter @sakurachiyo0v0/netease-music build       # 构建 ESM + CJS + d.ts + CLI
```

**更多细节：** [`packages/netease-music/README.md`](../packages/netease-music/README.md)

### `@sakurachiyo0v0/booth`

BOOTH(booth.pm,Pixiv 旗下数字商品市场)领取/购买 SDK:登录态管理、商品解析、免费领取 / 付费下单、订单文件下载与批量编排。BOOTH 无官方公开 API,SDK 基于页面协议模拟(商品页 JSON-LD / 下单端点),端点集中在 `src/api/endpoints.ts` 常量化管理。设计文档 [`docs/superpowers/specs/2026-08-23-booth-sdk-design.md`](superpowers/specs/2026-08-23-booth-sdk-design.md)。

**适用环境：** Node.js 20+,运行在可信任的服务端进程;不要在浏览器/WebView 中保存会话 cookie。

**核心接口：**

- `createBoothClient({ cookie?, authPath?, baseUrl?, fetchImpl?, download?, claim? })` — 创建客户端;显式 cookie 优先,否则从 AuthStore(`<配置根>/amechan/booth/auth.json`)加载
- `client.getItem(input)` — 解析链接或纯 ID → `BoothItem`(标题/价格/店铺/是否已拥有)
- `client.claim(inputs, { concurrency? })` — 批量领取:免费直接成交 / 付费生成待支付订单(返回支付 URL,支付留在浏览器)/ 已拥有跳过;保持输入顺序,单项失败不中断
- `client.isOrderPaid(orderId)` — 订单支付状态(付费商品浏览器支付后确认可下载)
- `client.getOrderFiles(orderId)` / `client.downloadOrder(orderId, { outputDir? })` — 文件清单 / 下载到 `outputDir/<orderId>/`
- `client.claimAndDownload(input, { outputDir? })` — 领取后下载一条龙(付费待支付不下载)
- `loginBooth({ authPath?, openBrowser? })` — 浏览器登录捕获(本地回环临时 HTTP 接收 cookie,复用 account AuthStore 持久化)
- `BoothError` — 统一错误码:`NETWORK` / `API_ERROR` / `NOT_FOUND` / `INVALID_URL` / `LOGIN_REQUIRED` / `AUTH_EXPIRED` / `ALREADY_OWNED` / `PAYMENT_REQUIRED` / `DOWNLOAD_FAILED` / `UNKNOWN`

**合规边界：** 只操作自己的账号、领取/下载自己拥有的商品;不绕过支付、不伪装会员、不代抢;付费商品仅生成待支付订单,支付永远在浏览器手动完成;批量领取默认并发 1,避免站方压力。

**安装方式：**

同一 pnpm workspace 内:

```powershell
pnpm add @sakurachiyo0v0/booth@workspace:*
```

从私有 GitHub monorepo 安装(需授权 `@sakurachiyo0v0/booth` 与 `@sakurachiyo0v0/account` 构建脚本):

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/booth"
```

**API 示例：**

```ts
import { createBoothClient } from "@sakurachiyo0v0/booth";

const client = createBoothClient();
const item = await client.getItem("https://booth.pm/ja/items/12345");
const results = await client.claim(["12345"]);
if (results[0]?.status === "claimed" && results[0].orderId) {
  await client.downloadOrder(results[0].orderId, { outputDir: "./downloads" });
}
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/booth typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/booth test        # 单测(本地 mock BOOTH 服务器,真实协议路径)
pnpm --filter @sakurachiyo0v0/booth build       # 构建 ESM + CJS + d.ts + CLI
```

**更多细节：** [`packages/booth/README.md`](../packages/booth/README.md)

### `@sakurachiyo0v0/vrchat`

VRChat 官方 REST API SDK。认证（密码 + 2FA，基于 `@sakurachiyo0v0/account` 密码登录骨架）+ 用户 / 世界 / 头像 / 实例 / 好友 / 通知等能力,分阶段交付。设计文档 [`docs/superpowers/specs/2026-08-23-vrchat-sdk-design.md`](superpowers/specs/2026-08-23-vrchat-sdk-design.md)。

**适用环境：** Node.js 20+，用户机器或服务器上的 Node 进程。凭证只保存 cookie，不保存密码。

**核心接口：**

- `createVrchatClient({ authPath?, cookie?, baseUrl?, ... })` — 创建客户端；优先使用显式 cookie，否则从 AuthStore（`<配置根>/amechan/vrchat/auth.json`）加载
- `client.login({ username, password, onNeedCode?, store? })` — 密码登录（2FA：邮箱 OTP / TOTP 经 `onNeedCode` 交互）
- `client.auth` — 认证域：`currentUser()` / `checkSession()` / `logout()` / `getConfig()`
- `client.users` — 用户域：`getById()` / `getByUsername()` / `search()` / `getFriendStatus()` / `getUserWorlds()` / `updateCurrent()`
- `client.worlds` — 世界域：`getById()` / `search()` / `getInstances()` / `getMetadata()` / `publish()` / `update()` / `delete()`
- `client.avatars` — 头像域：`getById()` / `search()` / `listOwned()` / `selectCurrent()` / `selectFallback()`
- `client.instances` — 实例域：`getById()` / `getByShortName()` / `create()`
- `client.friends` — 好友域：`list()` / `sendRequest()` / `delete()`
- `client.notifications` — 通知域：`list()` / `accept()` / `hide()` / `clear()`
- `client.favorites` — 收藏域：`list()` / `add()` / `remove()` / `listGroups()` / `createGroup()` / `deleteGroup()`
- `client.groups` — 群组域：`getById()` / `search()` / `create()` / `update()` / `delete()` / `listMembers()` / `listRoles()` / `createRole()` / `deleteRole()` / `join()` / `leave()` / `getAnnouncement()` / `setAnnouncement()`
- `client.files` — 文件域：`getById()` / `list()` / `create()` / `delete()` / `startUpload()` / `finishUpload()` / `getUploadStatus()`（完整上传链路）
- `client.permissions` — 权限域：`list()` / `getById()`
- `client.system` — 系统域：`health()`(需登录)/ `stats()`(在线人数,无需登录)/ `time()`(无需登录)
- `client.economy` — 经济域：`getBalance()` / `getTransactions()`
- `client.moderation` — 审核域：`list()` / `create()` / `delete()` / `report()`
- `client.invite` — 邀请域：`invite()` / `requestInvite()` / `joinSelf()` / `respond()`
- `VrchatError` — 错误码 `LOGIN_REQUIRED` / `AUTH_EXPIRED` / `INVALID_CREDENTIALS` / `TWO_FACTOR_REQUIRED` / `TWO_FACTOR_FAILED` / `NOT_FOUND` / `FORBIDDEN` / `RATE_LIMIT` / `NETWORK` / `TIMEOUT` / `UNKNOWN`，消息脱敏

**关键机制：** 强制 User-Agent；cookie 自动携带；429 自动退避重试（读 `Retry-After`）；401 → `AUTH_EXPIRED`。

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/vrchat@workspace:*
```

从私有 GitHub monorepo 安装（需授权 `@sakurachiyo0v0/vrchat` 与 `@sakurachiyo0v0/account` 构建脚本）：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/vrchat"
```

**API 示例：**

```ts
import { createVrchatClient } from "@sakurachiyo0v0/vrchat";

const client = await createVrchatClient();
await client.login({
  username: "alice",
  password: "pw",
  onNeedCode: () => "123456", // 2FA 验证码
});
const me = await client.auth.currentUser();
console.log(me.displayName);
await client.logout();
await client.close();
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/vrchat typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/vrchat test        # 单测（本地 mock VRChat API,真实 HTTP 协议路径）
pnpm --filter @sakurachiyo0v0/vrchat build       # 构建 ESM + CJS + d.ts + CLI
```

**更多细节：** [`packages/vrchat/README.md`](../packages/vrchat/README.md)

### `@sakurachiyo0v0/steam`

Steam SDK(查询向):官方 Web API(`api.steampowered.com`)+ Storefront(`store.steampowered.com`)+ 社区站点(`steamcommunity.com`)。**写操作仅激活码兑换一项**(`redeem`,用户拍板扩展红线);市场买卖、交易创建、好友增删等仍零写。设计文档 [`docs/superpowers/specs/2026-08-23-steam-sdk-design.md`](superpowers/specs/2026-08-23-steam-sdk-design.md);调研报告 [`docs/steam-api-research.md`](steam-api-research.md)。

**适用环境:** Node.js 20+,服务端进程。`steamcommunity.com` 国内网络不可达,社区相关请求需配置 `proxy`(undici ProxyAgent)。

**当前能力(P0 基础设施 + P1 公开查询 + P2 登录态 + P3 登录后只读深水区):**

- `createSteamClient({ apiKey?, publisherKey?, proxy?, baseUrls?, sessionPath?, cache?, ... })` — 客户端工厂
- 四主机 HTTP 层:Web API key 注入(`X-WebAPI-Key`)、会话 cookie 携带、429 退避重试(尊重 `Retry-After`)、TTL 缓存、超时、代理、脱敏日志
- `client.probe()` — `GetServerInfo` 连通性探针(无需 key);`client.getSupportedApiList()` — 动态枚举全部接口(需 key)
- `client.auth` — 密码登录(自动识别 Guard:邮箱验证码/TOTP/设备确认)、二维码登录、cookie 导入、会话状态/续期验证(`checkSession`)、`refreshCookies`、`logout`;登录态经 `@sakurachiyo0v0/account` AuthStore 持久化
- `client.user` — 资料摘要 / vanity 解析(支持 steamID64/3/2/vanity/URL 输入)/ 封禁信息 / 好友列表(隐私语义)/ 等级 / 徽章 / 徽章任务 / 群组 / 动态流(`recentActivity` XML)/ 评论读
- `client.library` — 游戏库(`GetOwnedGames` 隐私空结果 → `privacyRestricted` 标记)/ 家庭共享 / 近期游戏 / 愿望单(公开读,隐私标记)
- `client.stats` — 成就/统计定义、玩家成就与统计、全局成就/统计、在线人数
- `client.news` — 游戏新闻(无需 key)
- `client.store` — appdetails / featured / packagedetails / dlcforapp / 商店搜索 / GetAppList / 商店评测 `getAppReviews` 等(无需 key,`cc`/`l` 本地化)
- `client.inventory` — 公开库存(`/inventory/:steamid/:appid/:contextid`,默认不缓存)/ 自己库存(需登录态)/ `GetItemDefs` 物品定义(publisher key)
- `client.market` — 单件即时价 `priceoverview` / 市场搜索 `search/render` / 订单簿 `itemordershistogram` / 价格历史 `pricehistory` / 我的挂单 `mylistings` / 成交历史 `myhistory`(后两者需登录态;全部只读)
- `client.workshop` — `GetPublishedFileDetails`(POST form,无需 key)/ `EnumerateUserPublishedFiles` / `EnumerateUserSubscribedFiles`
- `client.trade`(只读)— 交易报价 `GetTradeOffers` / 单笔报价 `GetTradeOffer` / 交易历史 `GetTradeHistory`(需 key)/ 交易链接解析(需登录态);零写操作
- `client.redeem` — 激活码兑换 `redeemActivationKey`(**写操作**;store 页面协议:registerkey 302+Set-Cookie 会话刷新 → ajaxregisterkey JSON,ePurchaseResult 码映射;全 SDK 唯一写能力,需登录态)
- `SteamError` — 错误码 `NETWORK`/`TIMEOUT`/`RATE_LIMIT`/`AUTH_EXPIRED`/`LOGIN_REQUIRED`/`FORBIDDEN`/`NOT_FOUND`/`INVALID_URL`/`INVALID_CREDENTIALS`/`TWO_FACTOR_REQUIRED`/`TWO_FACTOR_FAILED`/`CONFIGURATION`/`UNKNOWN`,消息脱敏
- SteamID 工具:`parseSteamId` / `steamId64ToAccountId` / `accountIdToSteamId64` / `steamId64ToSteamId2|3` / `accountIdToSteamId2|3`(BigInt 精确运算,steamID64 超出 JS Number 安全范围)
- 登录协议自研(RSA 密码加密 → IAuthenticationService 全流程 → finalizelogin web cookie),零第三方登录依赖
- `amechan-steam` CLI:`login`(密码/QR/cookie 导入)/ `status` / `logout` / `user` / `owned-games` / `achievements` / `price` / `search` / `inventory` / `my-listings` / `reviews` / `redeem` / `watch`,JSON 输出;写操作仅 `redeem`;skill 手册 [`skills/steam-cli/SKILL.md`](../skills/steam-cli/SKILL.md)

**P5 收尾状态:** README / packages-index / CLI / skill / 版本 bump 均已交付(v0.5.1 已发布,CI publish success);剩余发布后消费验证 `pnpm verify:published @sakurachiyo0v0/steam`(前置:本机 `.npmrc` 配置 GitHub Packages token)。

**在仓库内的验证方式:**

```powershell
pnpm --filter @sakurachiyo0v0/steam typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/steam test        # 单测(mock 四台主机走真实 HTTP 协议路径,含 RSA 密码往返)
pnpm --filter @sakurachiyo0v0/steam build       # 构建 ESM + CJS + d.ts
```

**更多细节:** [`packages/steam/README.md`](../packages/steam/README.md)

### `@sakurachiyo0v0/xiaoheihe`

小黑盒(xiaoheihe.cn)SDK:扫码登录(复用 `@sakurachiyo0v0/account` 骨架)+ hkey/nonce 签名 + **只读查询**(帖子/评论/feed/@消息/用户)。P0 只读,写操作(回复评论)属红线扩展(P1,待拍板)。协议层提炼自 Go 参考实现 [xhhRobot](https://github.com/qingkongfeixing/xhhRobot)(xhh/ 包),仅取协议、不含机器人逻辑。设计文档 [`docs/superpowers/specs/2026-08-24-xiaoheihe-sdk-design.md`](superpowers/specs/2026-08-24-xiaoheihe-sdk-design.md)。

**适用环境:** Node.js 20+;登录态经 account AuthStore 持久化(`<配置根>/amechan/xiaoheihe/auth.json`);小黑盒 API 为逆向协议,签名算法可能随版本更新失效(集中在 `src/sign.ts`)。

**核心接口:**

- `createXiaoheiheClient({ cookie?, authPath?, baseUrl?, deviceId?, fetchImpl? })` — 客户端工厂;显式 cookie 优先,否则自动从 AuthStore 加载
- `client.feeds.list()` — 首页帖子流(`GET /bbs/app/feeds`)
- `client.links.getDetail({ linkId, page?, limit? })` — 帖子详情 + 评论区单页(`/bbs/app/link/tree`,正文解析为段落数组)
- `client.links.getSubComments({ rootCommentId, lastval? })` — 子评论游标翻页(`/bbs/app/comment/sub/comments`)
- `client.messages.listAt({ offset?, limit? })` — @消息列表(`/bbs/app/user/message`,需登录)
- `client.user.getProfile(userId)` — 用户资料(`/bbs/app/user/profile`,需登录)
- `client.auth.status()` / `logout()` — 登录态校验 / 清除
- `xiaoheiheQrAdapter()` — 扫码登录适配器(`QrLoginAdapter` 实现,复用 account 的 `qrcodeLogin`)
- 签名自动注入:每请求携带 `hkey`(7 字符混淆签名)/`_time`/`nonce` + 固定公共参数(`os_type=web`、`version=999.0.4`、`web_version=2.5` 等)
- `XiaoheiheError` — 错误码:`NETWORK`/`API_ERROR`/`LOGIN_REQUIRED`/`AUTH_EXPIRED`/`CAPTCHA`/`RATE_LIMIT`/`TIMEOUT`/`INVALID_URL`/`CONFIGURATION`/`UNKNOWN`,消息脱敏

**风控只感知不规避:** 响应含 `captcha`/`ticket` 或 `status` 为 `show_captcha`/`error_captcha` → 抛 `CAPTCHA`,不做验证码破解/冷却切换/影子检测/备用号(参考实现中的机器人规避逻辑一律不包含)。

**安装方式:**

同一 pnpm workspace 内:

```powershell
pnpm add @sakurachiyo0v0/xiaoheihe@workspace:*
```

从私有 GitHub monorepo 安装(需授权 `@sakurachiyo0v0/xiaoheihe` 与 `@sakurachiyo0v0/account` 构建脚本):

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/xiaoheihe"
```

**API 示例:**

```ts
import { createXiaoheiheClient, xiaoheiheQrAdapter } from "@sakurachiyo0v0/xiaoheihe";
import { AuthStore, qrcodeLogin } from "@sakurachiyo0v0/account";

await qrcodeLogin({ adapter: xiaoheiheQrAdapter(), store: new AuthStore({ platform: "xiaoheihe" }) });
const client = createXiaoheiheClient();
const links = await client.feeds.list();
const detail = await client.links.getDetail({ linkId: links[0]!.linkid });
```

**CLI:** `amechan-xiaoheihe login|status|logout|feed|link|comments|messages|user`(JSON 输出;`--no-browser` 关自动开浏览器);skill 手册 [`skills/xiaoheihe-cli/SKILL.md`](../skills/xiaoheihe-cli/SKILL.md)。

**在仓库内的验证方式:**

```powershell
pnpm --filter @sakurachiyo0v0/xiaoheihe typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/xiaoheihe test        # 37 单测(mock 服务器真实协议路径)
pnpm --filter @sakurachiyo0v0/xiaoheihe build       # 构建 ESM + CJS + d.ts + CLI
```

真实 API 冒烟(需登录态,不入测试套件)已验证:feeds / link/tree / 子评论翻页均通过,签名算法被真实服务接受。

**更多细节:** [`packages/xiaoheihe/README.md`](../packages/xiaoheihe/README.md)

### `@sakurachiyo0v0/dsh-sdk-tools`

DSH(DeepSeek Harness)host 插件,把本仓库功能包包装成 agent 工具,通过 **Agent 预设**按需暴露——选中 `ts-dev-kits` 预设的会话才拥有这些工具,其余会话零污染、0 token 开销。设计文档 [`docs/superpowers/specs/2026-08-23-dsh-sdk-tools-design.md`](superpowers/specs/2026-08-23-dsh-sdk-tools-design.md)。

**适用环境：** Node.js 20+ 且已安装 DSH(`@deepseek-ai/dsh`,对齐 `0.1.1-rc.2`);各功能包真实前置条件依旧生效(lol 需本机客户端、email 需配置 SMTP、bilibili/网易云/vrchat 需登录态)。

**机制：** 插件不设 `dsh.bundle`,是普通 profile 依赖;工具由预设的 `agent.cordis.yml` 声明挂载,注册落在该预设的 scope 层,只有加入该预设的 agent 可见。每包有 `enabled` 开关,未启用即不注册 → 不进 system prompt。

**工具清单：**

- bilibili:`bilibili_parse` / `bilibili_download`
- netease-music:`netease_parse` / `netease_download` / `netease_status`
- ffmpeg:`ffmpeg_probe` / `ffmpeg_transcode` / `ffmpeg_extract_audio` / `ffmpeg_thumbnail`
- email:`email_verify` / `email_send`(默认关,配置 SMTP 后启用)
- lol:`lol_summoner` / `lol_match_history` / `lol_ranked`
- vrchat:`vrchat_whoami` / `vrchat_user` / `vrchat_worlds_search`(默认关,需本地 VRChat 登录态 auth.json)

**安全与合规：** SMTP 密码等敏感配置只存在于 host 端预设 config;工具返回与错误消息脱敏;netease 的试听拦截/权限拒绝硬规则在 SDK 层强制,工具层不绕过。

**安装方式：**

```powershell
# 1. .npmrc 配置 @sakurachiyo0v0 指向 GitHub Packages(仓库已公开,无需 token)
#    @sakurachiyo0v0:registry=https://npm.pkg.github.com/
# 2. 装进 DSH profile 依赖(需先在 GitHub Packages 发布,见 docs/GITHUB_PACKAGES.md)
npx -p @deepseek-ai/dsh dsh plugin --profile <name> add @sakurachiyo0v0/dsh-sdk-tools
# 3. 复制随包分发的预设模板到 DSH 用户预设目录
Copy-Item -Recurse <profile>/node_modules/@sakurachiyo0v0/dsh-sdk-tools/presets/ts-dev-kits "$env:DSH_HOME/.agent-presets/"
# 4. 重启 DSH,新建会话选择 ts-dev-kits 预设
```

仓库内开发时也可用本地路径安装;未发布跨机时用 git 子目录依赖。

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/dsh-sdk-tools typecheck
pnpm --filter @sakurachiyo0v0/dsh-sdk-tools test
pnpm --filter @sakurachiyo0v0/dsh-sdk-tools build
```

**更多细节：** [`packages/dsh-sdk-tools/README.md`](../packages/dsh-sdk-tools/README.md)
