# ts-dev-kits 依赖包索引

本文件是仓库内所有可复用依赖包的总索引。维护原则：

- 新增一个依赖包时，在「总览」表格追加一行，并按照下文格式补一段「包详情」。
- 新建包的目录结构约定见 [`package-template.md`](package-template.md)。
- 表格中的「引用方式」列填写最常用的安装方式；完整选项见对应包的详情。
- 所有 `@sakurachiyo0v0/*` 包也发布到 GitHub Packages(GitHub npm 仓库,消费方需在 `.npmrc` 配置认证),外部项目配置一次 `.npmrc` 后即可 `pnpm add @sakurachiyo0v0/<name>` 直接安装 —— 见 [`GITHUB_PACKAGES.md`](GITHUB_PACKAGES.md)。

## 总览

| 包名 | 版本 | 用途 | 状态 | 引用方式 |
| --- | --- | --- | --- | --- |
| `@sakurachiyo0v0/cli-utils` | 0.1.3 | CLI 工具底座(参数解析/输出/错误处理/进度条,所有 SDK CLI 复用) | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/cli-utils` |
| `@sakurachiyo0v0/email` | 0.2.2 | 与供应商解耦的 Node.js 邮件 SDK | 可用（SMTP 适配器） | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/email` |
| `@sakurachiyo0v0/ffmpeg` | 0.2.3 | FFmpeg/ffprobe 进程封装 + 媒体处理高层函数 | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/ffmpeg` |
| `@sakurachiyo0v0/bilibili` | 0.6.0 | B 站 SDK:视频下载(解析/取流/下载/ffmpeg 合并)+ 平台控制(收藏夹/关注/分组/互动/动态/稍后再看/历史) | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/bilibili` |
| `@sakurachiyo0v0/chat-platforms` | 0.1.2 | 统一聊天平台接入 SDK(消息模型/适配器注册表,当前飞书) | 可用(飞书, websocket/webhook) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/chat-platforms` |
| `@sakurachiyo0v0/lol` | 0.1.3 | 英雄联盟 LCU 本地能力 SDK(召唤师/战绩/段位/对局流程/游戏数据/事件) | 可用(查询+对局感知, 国服 SGP) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/lol` |
| `@sakurachiyo0v0/account` | 0.5.5 | 跨平台账号认证底座(登录态存储/扫码+密码+浏览器登录骨架/错误模型) | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/account` |
| `@sakurachiyo0v0/netease-music` | 0.8.0 | 网易云音乐下载 SDK(weapi 加密/二维码登录/权限感知品质/试听拦截/取流/歌词/搜索) | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/netease-music` |
| `@sakurachiyo0v0/media-downloader` | 0.2.2 | 通用媒体下载 SDK:目录选择/流式下载+重试+进度/元数据封面写入/下载历史 | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/media-downloader` |
| `@sakurachiyo0v0/booth` | 0.4.3 | BOOTH(booth.pm)领取/购买 SDK:登录态管理/商品解析/免费领取/付费下单/文件下载 | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/booth` |
| `@sakurachiyo0v0/vrchat` | 0.4.3 | VRChat 官方 REST API SDK(认证/用户/世界/头像/实例/好友/通知/收藏/群组/文件/权限/系统/经济/审核) | 可用(全功能覆盖) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/vrchat` |
| `@sakurachiyo0v0/steam` | 0.8.3 | Steam SDK(查询向):Web API/Storefront/Community 三套接口,登录态支持,写操作仅激活码兑换一项 | 可用(全阶段交付) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/steam` |
| `@sakurachiyo0v0/xiaoheihe` | 0.4.3 | 小黑盒 SDK:扫码登录 + hkey/nonce 签名 + 只读查询(帖子/评论/feed/@消息/用户) | 可用(P0 只读) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/xiaoheihe` |
| `@sakurachiyo0v0/dsh-sdk-tools` | 0.5.4 | DSH host 插件:把 bilibili/netease-music/ffmpeg/email/lol/vrchat/kazumi 包装成 agent 工具,经 Agent 预设按需暴露 | 可用 | `pnpm add @sakurachiyo0v0/dsh-sdk-tools`(GitHub Packages) |
| `@sakurachiyo0v0/database` | 0.2.3 | 统一数据访问抽象层:一套 API 访问本地 SQLite 与远程 PostgreSQL/MySQL,配置切换后端 | 可用(SQLite 全量,远程可选) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/database` |
| `@sakurachiyo0v0/webdav` | 0.3.2 | WebDAV 配置存取 SDK:基础文件操作 + ConfigStore(原子写/自动备份) + 加密存储 + CLI | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/webdav` |
| `@sakurachiyo0v0/config` | 0.4.0 | 配置中心 SDK:WebDAV+密钥全局一次配置,namespace 按域存取(可选加密),登录态/配置多端同步 | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/config` |
| `@sakurachiyo0v0/chuanshengtong` | 0.3.2 | 传声筒:输入文字 + 内置图像模板程序化合成图片(CLI + SDK,不依赖 AI,支持富文本) | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/chuanshengtong` |
| `@sakurachiyo0v0/logger` | 0.2.1 | 轻量级日志模块:级别控制/命名空间/多机主机标识/子 logger 派生/可替换 transport | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/logger` |
| `@sakurachiyo0v0/kazumi` | 0.1.2 | Kazumi 规则兼容番剧采集下载 SDK:声明式规则引擎(XPath/API 双模式)+ m3u8 下载合并 mp4 + 规则 WebDAV 多端同步 | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/kazumi` |

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

从 GitHub monorepo 安装（需先在消费项目 `pnpm-workspace.yaml` 中授权构建脚本，见包内 README）：

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

从 GitHub monorepo 安装(需先在消费项目 `pnpm-workspace.yaml` 中授权构建脚本,见包内 README)：

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

从 GitHub monorepo 安装(需授权 `@sakurachiyo0v0/bilibili` 与 `@sakurachiyo0v0/ffmpeg` 两个构建脚本)：

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

从 GitHub monorepo 安装（需授权 `@sakurachiyo0v0/chat-platforms` 与 `@larksuiteoapi/node-sdk` 构建脚本）：

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

从 GitHub monorepo 安装（需在消费项目 `pnpm-workspace.yaml` 中授权 `@sakurachiyo0v0/lol` 构建脚本）：

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

跨平台账号认证底座(薄):登录态存储、扫码/密码/浏览器三种登录骨架与公共错误模型。**不感知具体平台**——网易云、B 站、酷狗、QQ 音乐等平台的登录差异收敛在各自的 `QrLoginAdapter` / `PasswordLoginAdapter` / `BrowserLoginAdapter` 实现里,登录流程、存储、CLI 全复用。设计文档 [`docs/superpowers/specs/2026-08-23-netease-music-sdk-design.md`](superpowers/specs/2026-08-23-netease-music-sdk-design.md)。

**适用环境:** Node.js 20+，桌面环境（需要打开浏览器）；无头环境可用 `autoOpenBrowser: false`。

**核心接口：**

- `AuthStore` — 跨平台登录态存储：`new AuthStore({ platform, path? })`，默认 `<配置根>/amechan/<platform>/auth.json`，原子写 + 600 权限；`save()` / `load()` / `loadSync()` / `clear()` / `exists()`
- `qrcodeLogin({ adapter, store?, ... })` — 扫码登录骨架：本地窗口 + 系统浏览器弹二维码 → 手机 App 扫码 → 轮询确认 → 收集凭证 → 可选持久化；返回 `{ credentials, saved }`
- `QrLoginAdapter` — 扫码平台适配器契约：`generateKey()` / `pollStatus()` / `refresh?()` / `serialize()` / `deserialize()`；扫码平台接入 = 实现这 5 个方法
- `passwordLogin({ adapter, username, password, onNeedCode?, store?, ... })` — 密码登录骨架：提交用户名密码 → 若需 2FA 循环取码验证 → 成功可选持久化；2FA 交互经 `onNeedCode` 回调
- `PasswordLoginAdapter` — 密码平台适配器契约：`login()` / `verifyCode()` / `refresh?()` / `serialize()` / `deserialize()`；密码平台（如 VRChat）接入 = 实现这 5 个方法
- `browserLogin({ adapter, store?, browserPath?, reuseBrowserProfile?, useCdp?, ... })` — 浏览器登录骨架（CDP 弹出独立 Chrome 窗口捕获会话 cookie → 平台校验 → 可选持久化；无浏览器时回退捕获页）；适用于无公开登录 API、只能靠网页浏览器会话的平台（如 BOOTH）
- `BrowserLoginAdapter` — 浏览器平台适配器契约：`loginUrl` / `cookieDomains` / `sessionCookieNames` / `validate?()` / `serialize()` / `deserialize()`；"网页登录型"平台接入 = 实现这 6 项
- `detectBrowser()` / `defaultBrowserProfileDir()` — 定位本机 Chrome/Edge 及其日常 profile（供 `browserLogin` 复用日常登录态）
- `resolveConfigRoot()` / `defaultAuthPath(platform)` — 配置目录解析（`resolveConfigRoot` re-export 自 `@sakurachiyo0v0/config` 唯一权威实现;Windows `%APPDATA%`(回退 `AppData/Roaming`) / macOS `~/Library/Application Support` / Linux `$XDG_CONFIG_HOME`,支持 `AMECHAN_CONFIG_HOME` 覆盖）
- `AccountError` — 错误码 `NETWORK` / `API_ERROR` / `AUTH_EXPIRED` / `LOGIN_REQUIRED` / `UNKNOWN` / `INVALID_CREDENTIALS` / `TWO_FACTOR_REQUIRED` / `TWO_FACTOR_FAILED`

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/account@workspace:*
```

从 GitHub monorepo 安装：

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
- `client.getStreamUrl(id, level?)` — 获取单曲播放流 URL（默认 `exhigh`），供网页/播放器直接播放
- `client.getLyric(id)` — 获取歌词（LRC 原文 + 翻译）
- `client.search(keyword, { limit? })` — 搜索歌曲，返回 `SongInfo[]`（含歌手/专辑/时长）
- `client.download(item, { outputDir?, level?, lyric?, lyricMode?, cover?, writeTags?, onProgress? })` — 下载（权限预检 + 试听拦截强制），返回 `{ filePath, level, lyricPath?, coverPath? }`
- `client.downloadByInput(input)` — 按链接或歌曲 ID 便捷下载
- `neteaseQrAdapter()` — 网易云二维码登录适配器（供 `qrcodeLogin` 使用）
- 品质等级：`standard`(128k) / `higher`(192k) / `exhigh`(320k) / `lossless`(FLAC) / `hires`
- `NeteaseError` — 错误码 `NETWORK` / `API_ERROR` / `NOT_FOUND` / `INVALID_URL` / `LOGIN_REQUIRED` / `AUTH_EXPIRED` / `PRIVILEGE_DENIED` / `TRIAL_ONLY` / `DOWNLOAD_FAILED` / `UNKNOWN`

**CLI：** `sc-netease login|status|logout|parse|download`（选项 `--auth-path` / `--no-browser` / `--qr-image <path>` / `--level` / `--output-dir` / `--no-lyric` / `--no-cover` / `--lyric-mode`）。

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/netease-music@workspace:*
```

从 GitHub monorepo 安装（需授权 `@sakurachiyo0v0/netease-music`、`@sakurachiyo0v0/account`、`@sakurachiyo0v0/ffmpeg` 构建脚本）：

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

### `@sakurachiyo0v0/media-downloader`

通用媒体下载 SDK：与具体平台无关。调用方负责拿到「最终媒体 URL + 文件名」，本包负责落盘到选定目录、流式下载（重试 + 进度）、元数据/封面写入、下载历史。设计初衷：B 站/番剧/网易云等多平台共用同一套「选目录 + 下载执行 + 历史」，避免重复实现。

**适用环境：** Node.js 20+；元数据标签与内嵌封面写入需系统安装 `ffmpeg`（通过 `@sakurachiyo0v0/ffmpeg`）。

**核心接口：**

- `new DownloadManager({ root, userAgent?, retries? })` — 创建管理器，root 为下载根目录
- `manager.listDirs()` — 列出可选的子目录（首项 `""` 表示根目录，递归到第 2 层）
- `manager.download(target, onProgress?)` — 下载一个目标（`{ url, filename, dir?, tags?, coverUrl? }`），返回 `{ filePath }`
- `manager.history()` / `manager.clearHistory()` — 下载历史（内存 + 持久化到 `root/.download-state.json`，最多 100 条）
- `manager.record(record)` — 外部下载完成后记录一条历史（供不走 `download` 方法的场景复用）
- `DownloaderError` — 统一错误码 `INVALID_TARGET` / `DOWNLOAD_FAILED` / `EMPTY_BODY`

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/media-downloader@workspace:*
```

从 GitHub monorepo 安装（需授权 `@sakurachiyo0v0/media-downloader`、`@sakurachiyo0v0/ffmpeg`、`@sakurachiyo0v0/logger` 构建脚本）：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/media-downloader"
```

**API 示例：**

```ts
import { DownloadManager } from "@sakurachiyo0v0/media-downloader";

const manager = new DownloadManager({ root: "/downloads" });
const dirs = manager.listDirs(); // ["", "周杰伦", "欧美"]
const result = await manager.download({
  url: "http://m804.music.126.net/xxx.mp3",
  filename: "周杰伦 - 晴天.mp3",
  dir: "周杰伦",
  tags: { title: "晴天", artist: "周杰伦", album: "叶惠美" },
  coverUrl: "http://p1.music.126.net/xxx.jpg",
});
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/media-downloader typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/media-downloader test        # 单测（本地 HTTP 服务真实下载链路）
pnpm --filter @sakurachiyo0v0/media-downloader build       # 构建 ESM + CJS + d.ts
```

**更多细节：** [`packages/media-downloader/README.md`](../packages/media-downloader/README.md)

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
- `loginBooth({ authPath?, openBrowser?, useCdp?, reuseBrowserProfile? })` — 浏览器登录（复用 account `browserLogin` 骨架：CDP 自动捕获会话 cookie → 捕获页回退；`--reuse` 复用日常浏览器登录态免输账号密码）
- `BoothError` — 统一错误码:`NETWORK` / `API_ERROR` / `NOT_FOUND` / `INVALID_URL` / `LOGIN_REQUIRED` / `AUTH_EXPIRED` / `ALREADY_OWNED` / `PAYMENT_REQUIRED` / `DOWNLOAD_FAILED` / `UNKNOWN`

**合规边界：** 只操作自己的账号、领取/下载自己拥有的商品;不绕过支付、不伪装会员、不代抢;付费商品仅生成待支付订单,支付永远在浏览器手动完成;批量领取默认并发 1,避免站方压力。

**安装方式：**

同一 pnpm workspace 内:

```powershell
pnpm add @sakurachiyo0v0/booth@workspace:*
```

从 GitHub monorepo 安装(需授权 `@sakurachiyo0v0/booth` 与 `@sakurachiyo0v0/account` 构建脚本):

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

从 GitHub monorepo 安装（需授权 `@sakurachiyo0v0/vrchat` 与 `@sakurachiyo0v0/account` 构建脚本）：

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
- `sc-steam` CLI:`login`(密码/QR/cookie 导入)/ `status` / `logout` / `user` / `owned-games` / `achievements` / `price` / `search` / `inventory` / `my-listings` / `reviews` / `redeem` / `watch`,JSON 输出;写操作仅 `redeem`;skill 手册 [`skills/steam-cli/SKILL.md`](../skills/steam-cli/SKILL.md)

**P5 收尾状态:** README / packages-index / CLI / skill / 版本 bump 均已交付(v0.2.0 已发布,CI publish success);剩余发布后消费验证 `pnpm verify:published @sakurachiyo0v0/steam`(前置:本机 `.npmrc` 配置 GitHub Packages token)。

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
- 签名自动注入:每请求携带 `hkey`(7 字符混淆签名)/`_time`/`nonce` + 固定公共参数(`os_type=web`、`version=0.2.0`、`web_version=2.5` 等)
- `XiaoheiheError` — 错误码:`NETWORK`/`API_ERROR`/`LOGIN_REQUIRED`/`AUTH_EXPIRED`/`CAPTCHA`/`RATE_LIMIT`/`TIMEOUT`/`INVALID_URL`/`CONFIGURATION`/`UNKNOWN`,消息脱敏

**风控只感知不规避:** 响应含 `captcha`/`ticket` 或 `status` 为 `show_captcha`/`error_captcha` → 抛 `CAPTCHA`,不做验证码破解/冷却切换/影子检测/备用号(参考实现中的机器人规避逻辑一律不包含)。

**安装方式:**

同一 pnpm workspace 内:

```powershell
pnpm add @sakurachiyo0v0/xiaoheihe@workspace:*
```

从 GitHub monorepo 安装(需授权 `@sakurachiyo0v0/xiaoheihe` 与 `@sakurachiyo0v0/account` 构建脚本):

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

**CLI:** `sc-xiaoheihe login|status|logout|feed|link|comments|messages|user`(JSON 输出;`--no-browser` 关自动开浏览器;`--qr-image <path>` 把二维码图片写入文件);skill 手册 [`skills/xiaoheihe-cli/SKILL.md`](../skills/xiaoheihe-cli/SKILL.md)。

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

**适用环境：** Node.js 20+ 且已安装 DSH(`@deepseek-ai/dsh`,对齐 `0.2.0-rc.2`);各功能包真实前置条件依旧生效(lol 需本机客户端、email 需配置 SMTP、bilibili/网易云/vrchat 需登录态)。

**机制：** 插件不设 `dsh.bundle`,是普通 profile 依赖;工具由预设的 `agent.cordis.yml` 声明挂载,注册落在该预设的 scope 层,只有加入该预设的 agent 可见。每包有 `enabled` 开关,未启用即不注册 → 不进 system prompt。

> ⚠️ **消费方式限制:** 本插件只能装进 DSH profile(`dsh plugin --profile <name> add`),**不能独立安装到普通 npm 项目**——其传递依赖 `@deepseek-ai/*` 只有 rc 预发布版,公共 npm 源无法解析(`ERR_PNPM_NO_MATCHING_VERSION`)。DSH 运行时自带完整的 rc 依赖树,是唯一正确的消费环境。

**工具清单：**

- bilibili:`bilibili_parse` / `bilibili_download`
- netease-music:`netease_parse` / `netease_download` / `netease_status`
- ffmpeg:`ffmpeg_probe` / `ffmpeg_transcode` / `ffmpeg_extract_audio` / `ffmpeg_thumbnail`
- email:`email_verify` / `email_send`(默认关,配置 SMTP 后启用)
- lol:`lol_summoner` / `lol_match_history` / `lol_ranked`
- vrchat:`vrchat_whoami` / `vrchat_user` / `vrchat_worlds_search`(默认关,需本地 VRChat 登录态 auth.json)
- logs:`logs_query` — 查询 SDK 日志(等级/设备/命名空间/关键词/时间,默认查远程跨机聚合)
- kazumi:`kazumi_search` / `kazumi_roads` / `kazumi_download` — 番剧规则采集与下载(搜索/线路/下载 mp4;规则由用户导入规则目录)

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

### `@sakurachiyo0v0/database`

统一数据访问抽象层 SDK:一套 async API(`query` / `execute` / `transaction` / `ping` / `close`)同时访问本地 SQLite 与远程 PostgreSQL / MySQL,切换后端只改配置。设计文档 [`docs/superpowers/specs/2026-08-24-database-sdk-design.md`](superpowers/specs/2026-08-24-database-sdk-design.md)。

**适用环境：** Node.js 20+,可信任的服务端进程;SQLite 基于 better-sqlite3(原生模块,主流平台有预编译二进制)。

**核心接口：**

- `createDataStore({ dialect, ... })` — 创建统一数据源;`sqlite` 传 `path`(支持 `:memory:`),`postgres`/`mysql` 传 `url`(可选 `maxConnections`,默认 10)
- `store.query<T>(sql, params?)` — 查询,参数化防注入,返回行数组
- `store.execute(sql, params?)` — 增删改/DDL,返回 `{ affectedRows }`
- `store.transaction(fn)` — 事务,失败自动回滚;嵌套调用抛 `TRANSACTION_ACTIVE`
- `store.ping()` / `store.close()` — 探活 / 释放连接(幂等)
- `DatabaseLogTransport` — 日志持久化 transport(配合 `@sakurachiyo0v0/logger`):本地 SQLite 即时写 + 远程 PostgreSQL 批量同步(断网重试),跨机聚合
- `queryLogs({ level?, hostname?, namespace?, from?, to?, keyword?, limit? })` — 日志查询 API(本地/远程/合并)
- `DataError` — 统一错误码 `CONFIGURATION` / `CONNECTION` / `QUERY_SYNTAX` / `CONSTRAINT` / `TRANSACTION_ACTIVE` / `CLOSED` / `TIMEOUT` / `UNKNOWN`,消息脱敏

**占位符规则：** 上层统一 `?`;PG 自动转 `$n`(跳过单引号字符串内 `?`),JSONB 多字符操作符 `?|`/`?&` 原样保留,单 `?` 用 `??` 转义(`data ?? 'key'`);SQLite/MySQL 原生直传。

**安装方式：**

```powershell
pnpm add @sakurachiyo0v0/database@workspace:*   # workspace 内
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/database"  # 其他机器
```

**API 示例：**

```ts
import { createDataStore } from "@sakurachiyo0v0/database";

const local = createDataStore({ dialect: "sqlite", path: "./data.db" });
const remote = createDataStore({ dialect: "postgres", url: "postgresql://user:***@host:5432/db" });

await local.execute("INSERT INTO users (name, age) VALUES (?, ?)", ["alice", 30]);
const users = await local.query("SELECT * FROM users WHERE age > ?", [18]);
await local.close();
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/database typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/database test        # 单测(SQLite 内存库全量;PG/MySQL 需环境变量启用)
pnpm --filter @sakurachiyo0v0/database build       # 构建 ESM + CJS + d.ts + CLI(sc-log)
```

**日志查询 CLI `sc-log`：** 按等级/设备/时间/命名空间/关键词查日志,本地与远程可合并。详见 [`skills/database-cli/SKILL.md`](../skills/database-cli/SKILL.md)。

**更多细节：** [`packages/database/README.md`](../packages/database/README.md)

### `@sakurachiyo0v0/webdav`

WebDAV 配置存取 SDK:基础文件操作(读/写/列/删/建目录/移动/复制)+ 配置文件存储高层 API(原子写 + 自动备份),带 CLI(`sc-webdav`)。适合存配置文件、多端同步的轻量场景。设计文档 [`docs/superpowers/specs/2026-08-24-webdav-sdk-design.md`](superpowers/specs/2026-08-24-webdav-sdk-design.md)。

**适用环境：** Node.js 20+,支持 Basic 认证的 WebDAV 服务(坚果云/Nextcloud 等)。

**核心接口：**

- `createWebdavClient({ url, username?, password?, timeoutMs? })` — 创建客户端;`ping/list/get/put/mkdir/remove/move/copy/exists`
- `createConfigStore(client, { basePath?, format?, backupCount? })` — 配置存储;`load/save/list/remove`;`save` 原子写(临时文件+move)+ 旧版自动滚动备份(`.bak.1/2/3`);`format` 支持 `json`/`text`
- `WebdavError` — 统一错误码 `AUTHENTICATION` / `CONNECTION` / `NOT_FOUND` / `CONFLICT` / `VALIDATION` / `UNKNOWN`,消息脱敏
- CLI `sc-webdav`:`ping/list/get/put/delete/mkdir/rmdir/move/config-load/config-save`,连接参数 `--url/--username/--password` 或环境变量 `WEBDAV_URL/WEBDAV_USERNAME/WEBDAV_PASSWORD`

**安装方式：**

```powershell
pnpm add @sakurachiyo0v0/webdav@workspace:*   # workspace 内
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/webdav"  # 其他机器
```

**API 示例：**

```ts
import { createWebdavClient, createConfigStore } from "@sakurachiyo0v0/webdav";

const wd = createWebdavClient({ url: "https://dav.jianguoyun.com/dav/", username: "u", password: "p" });
const store = createConfigStore({ client: wd, basePath: "/configs", format: "json" });
await store.save("app.json", { theme: "dark" });
const cfg = await store.load("app.json");
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/webdav typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/webdav test        # 单测(本地 webdav-server 真实协议路径)
pnpm --filter @sakurachiyo0v0/webdav build       # 构建 ESM + CJS + d.ts + CLI
```

**更多细节：** [`packages/webdav/README.md`](../packages/webdav/README.md)

### `@sakurachiyo0v0/config`

配置中心 SDK:WebDAV 服务器 + 密钥**全局一次配置**(本地 `<配置根>/amechan/config.json`,chmod 600),各 SDK/平台通过 `namespace("平台名")` 存取配置——统一基底 `/amechan/` 下按敏感度分域(`/amechan/configs/<ns>` 明文、`/amechan/secrets/<ns>` 加密),**按域决定是否加密**;换机器配好全局配置即还原登录态/配置。设计文档 [`docs/superpowers/specs/2026-08-24-config-center-design.md`](superpowers/specs/2026-08-24-config-center-design.md)。

**适用环境：** Node.js 20+,依赖 `@sakurachiyo0v0/webdav`(含加密存储)。

**核心接口：**

- `createConfigCenter({ configPath?, global? })` — 读本地全局配置(或显式传入)创建配置中心
- `cc.namespace(name, { encrypt? })` — 命名空间:encrypt 默认 false(明文 `/amechan/configs/<ns>/`),true 走加密(`/amechan/secrets/<ns>/`);返回 `get/set/list/remove`
- `saveGlobalConfig` / `loadGlobalConfig` / `clearGlobalConfig` / `resolveConfigPath` — 本地全局配置读写(文件 600 权限)
- `resolveConfigRoot` — **平台配置根目录唯一权威实现**(`AMECHAN_CONFIG_HOME` > win32 `APPDATA`(回退 `AppData/Roaming`) > darwin `Application Support` > `XDG_CONFIG_HOME` > `~/.config`);account / database / kazumi 等包统一引用,不再各自复制
- 错误:远端透传 webdav `WebdavError`;本地配置缺失/非法抛 `VALIDATION`

**注意事项：** 远端目录(`/amechan/configs/<ns>`、`/amechan/secrets/<ns>`)需预先存在(部分 WebDAV 服务如坚果云禁 WebDAV 建目录;自建服务可用 `wd.mkdir` 建);加密密钥本地保管,丢失无法解密。

**安装方式：**

```powershell
pnpm add @sakurachiyo0v0/config@workspace:*   # workspace 内
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/config"  # 其他机器
```

**API 示例：**

```ts
import { createConfigCenter } from "@sakurachiyo0v0/config";

const cc = createConfigCenter();   // 读本地全局配置(先 sc-config setup)
const xhh = cc.namespace("xiaoheihe", { encrypt: true });  // 敏感域,加密
await xhh.set("auth", { cookie: "SID=..." });
const auth = await xhh.get("auth");
const bili = cc.namespace("bilibili");                     // 明文域
await bili.set("ui", { quality: 80 });
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/config typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/config test        # 单测(本地 webdav-server 真实协议路径)
pnpm --filter @sakurachiyo0v0/config build       # 构建 ESM + CJS + d.ts + CLI
```

**更多细节：** [`packages/config/README.md`](../packages/config/README.md)

### `@sakurachiyo0v0/chuanshengtong`

传声筒:输入文字 + 内置图像模板,**程序化合成**输出图片(不依赖 AI 图像生成 API)。基于 `sharp`(SVG 文本层 → 栅格化),中文自动换行/居中/超长保护。设计文档 [`docs/superpowers/specs/2026-08-25-chuanshengtong-design.md`](superpowers/specs/2026-08-25-chuanshengtong-design.md)。

**适用环境：** Node.js 20+;中文渲染依赖系统安装中文字体(如 Noto Sans CJK / 文鼎),无中文字体时文字显示为方框。

**核心接口：**

- `listTemplates()` / `getTemplate(id)` — 列出/查询内置模板(id/名称/描述/尺寸/容量)
- `render({ template, text, output, format?, width?, fontSize?, color?, quality? })` — 渲染图片到文件,返回 `{ outputPath, width, height, format, bytes }`
- `wrapText(text, { fontSize, maxWidth, maxLines })` — 纯文本排版纯函数(中文按字符、英文按词断行,超长截断补省略号),返回 `{ lines, truncated }`
- `parseRichText(text)` / `wrapRichText(runs, opts)` — 富文本解析与样式感知排版:支持 `**加粗**`、`*斜体*`、`[c:red]彩色[/c]`,渲染为 SVG tspan,纯文本行为完全兼容
- 内置模板:`dazibao`(大字报)/ `speech-bubble`(台词气泡)/ `card`(卡片)/ `notice`(公告),全部程序化 SVG 生成,无外部图片资源
- `ChuanshengtongError` — 统一错误码:`TEMPLATE_NOT_FOUND` / `EMPTY_TEXT` / `TEXT_TOO_LONG` / `INVALID_OPTION` / `RENDER_FAILED` / `WRITE_FAILED` / `UNKNOWN`

**CLI：** `sc-chuanshengtong list|render <text>`(选项 `--template` / `--output` / `--format` / `--width` / `--font-size` / `--color` / `--quality`);skill 手册 [`skills/chuanshengtong-cli/SKILL.md`](../skills/chuanshengtong-cli/SKILL.md)。

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/chuanshengtong@workspace:*
```

从 GitHub monorepo 安装(需在消费项目 `pnpm-workspace.yaml` 授权 `sharp: true`):

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/chuanshengtong"
```

**API 示例：**

```ts
import { render } from "@sakurachiyo0v0/chuanshengtong";

await render({ template: "dazibao", text: "你好,世界", output: "./out.png" });
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/chuanshengtong typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/chuanshengtong test        # 单测(排版/转义/注册表 + sharp 真实渲染)
pnpm --filter @sakurachiyo0v0/chuanshengtong build       # 构建 ESM + CJS + d.ts + CLI
```

**更多细节：** [`packages/chuanshengtong/README.md`](../packages/chuanshengtong/README.md)

### `@sakurachiyo0v0/logger`

轻量级日志模块，为所有 SDK 包提供统一的日志能力。设计参考 pino 的 child logger 模式，支持命名空间、多机主机标识、子 logger 派生、bindings 绑定和可替换 transport。

**核心接口：**

- `createLogger({ namespace?, level?, hostname?, transport? })` — 创建 logger 实例
- `logger.debug/info/warn/error(message, data?)` — 输出各级别日志
- `logger.child(bindings)` — 派生带固定数据的子 logger（bindings 自动附加到每条日志）
- `logger.child(namespace)` — 派生命名空间子 logger（自动追加前缀，如 `bilibili:download`）
- `LogTransport` — 自定义 transport 接口，可替换输出目标

**级别控制：** `debug`(10) < `info`(20) < `warn`(30) < `error`(40) < `silent`(Infinity)，默认 `info`。子 logger 继承父级别。

**主机标识：** 默认自动检测 `os.hostname()`，多台机器部署时日志自动带 `@hostname` 来源；也可在 `createLogger` 时手动覆盖 `hostname`。

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/logger@workspace:*
```

从 GitHub monorepo 安装：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/logger"
```

**API 示例：**

```ts
import { createLogger } from "@sakurachiyo0v0/logger";

const logger = createLogger({ namespace: "bilibili", level: "debug" });

logger.info("开始下载", { videoId: "BV123" });
// [bilibili]@desktop-01 2024-08-23T10:00:00.000Z INFO 开始下载 { videoId: 'BV123' }

// 子 logger：自动追加命名空间
const dl = logger.child("download");
dl.info("完成");
// [bilibili:download]@desktop-01 2024-08-23T10:00:01.000Z INFO 完成

// 子 logger：绑定固定数据
const bound = logger.child({ videoId: "BV123" });
bound.info("进度", { percent: 50 });
// [bilibili]@desktop-01 2024-08-23T10:00:02.000Z INFO 进度 { videoId: 'BV123', percent: 50 }
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @sakurachiyo0v0/logger typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/logger test        # 单测(级别/hostname/命名空间/bindings/Error/transport)
pnpm --filter @sakurachiyo0v0/logger build       # 构建 ESM + CJS + d.ts
```

**更多细节：** [`packages/logger/README.md`](../packages/logger/README.md)

### `@sakurachiyo0v0/kazumi`

Kazumi 规则格式兼容的番剧采集下载 SDK:**声明式规则引擎**(XPath 抓 HTML + API 模板抓 JSON 双模式)+ **m3u8 下载合并成 mp4**(复用 `@sakurachiyo0v0/ffmpeg`)。规则格式与 [Kazumi](https://github.com/Predidit/Kazumi)/[KazumiRules](https://github.com/Predidit/KazumiRules) 生态兼容——换数据源不用写代码,改 JSON 规则即可。SDK **不内置任何站点规则**(引擎中立),规则由用户导入到自己的规则目录。设计文档 [`docs/superpowers/specs/2026-08-28-kazumi-sdk-design.md`](superpowers/specs/2026-08-28-kazumi-sdk-design.md)。

**适用环境:** Node.js 20+;下载合并 mp4 需系统安装 `ffmpeg`。

**核心接口:**

- `createAnimeClient({ rulesDir?, fetchImpl?, sync?, download? })` — 创建客户端;规则目录默认 `<配置根>/amechan/kazumi/rules/`;`sync: true` 开启规则 WebDAV 多端同步(经 config 包 namespace("kazumi"),加密存云端 `/amechan/secrets/kazumi/`,add/remove 双写、远端优先、无全局配置时优雅回退本地)
- `client.rules` — `list()` / `load(name)`(async,远端优先) / `validateJson(json)` / `add(json)`(双写) / `remove(name)`(双删)
- `client.search(keyword, { rules? })` — 搜索(打全部规则或指定规则),结果带 `[规则名]` 前缀
- `client.getRoads(item)` — 查线路(`Road { name, data[], identifier[] }`)
- `client.getEpisodes(item, road)` — 线路 → 集数(`Episode { name, url }`)
- `client.download(episode, { outputDir, rule, adFilter?, onProgress? })` — 下载单集 mp4
- `client.traceSearch(ruleName, keyword)` / `client.traceChapters(ruleName, source)` — 规则调试(原始响应 + 匹配片段 + 诊断)
- `RuleEngine` / `RestrictedJsonPath` / `parseM3u8` / `filterAds` 等底层能力可直接使用
- `KazumiError` — 统一错误码:`RULE_NOT_FOUND` / `RULE_INVALID` / `NO_RESULT` / `NETWORK` / `CAPTCHA` / `STREAM_PARSE_FAILED` / `DOWNLOAD_FAILED` / `MERGE_FAILED` / `UNKNOWN`,消息脱敏

**双模式规则引擎:**

- **XPath 模式**:`searchList`/`searchName`/`searchResult`/`chapterRoads`/`chapterResult` 选择器抓 HTML 页面(cheerio 容错解析 + 标准 XPath 1.0 求值;相对路径 `//x` 在节点上等价 `.//x`,与 Kazumi 语义一致)。
- **API 模式**:请求模板(method/url/headers/query/bodyType/body + `{keyword}`/`{source}` 变量)+ JSONPath 映射。
- **受限 JSONPath 沙箱**:只支持 `$`/`.key`/`['key']`/`[n]`/`[*]` 安全子集;函数调用/过滤/递归/通配属性一律拒绝(开放规则生态的硬门槛)。

**下载流程:** 播放页取流解析(静态递归:直出 m3u8 → video/source 标签 → iframe 跟踪,不执行 JS)→ m3u8 解析(master 自动选最高码率)→ discontinuity 分组广告过滤(剔除短广告分组)→ 并发分片下载(可配并发/重试/超时)→ 本地 m3u8 构建 → ffmpeg 合并 mp4(自动处理 AES-128 加密分片)。纯 JS 动态取流站点报 `STREAM_PARSE_FAILED`(真实站点试跑验证:AGE/ezdmw 搜索与线路解析通过;下载取流对 iframe 型可跟踪,JS 动态型需手动直链)。

**CLI `sc-kazumi`:** `search` / `roads` / `episodes` / `download` / `rules list|add|remove|validate|test`;规则调试首选 `rules test <name> <keyword>`(直接看匹配片段/诊断/原始响应预览)。skill 手册 [`skills/kazumi-cli/SKILL.md`](../skills/kazumi-cli/SKILL.md)。

**安装方式:**

同一 pnpm workspace 内:

```powershell
pnpm add @sakurachiyo0v0/kazumi@workspace:*
```

从 GitHub monorepo 安装(需授权 `@sakurachiyo0v0/kazumi` 与 `@sakurachiyo0v0/ffmpeg` 构建脚本):

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/kazumi"
```

**API 示例:**

```ts
import { createAnimeClient } from "@sakurachiyo0v0/kazumi";

const client = createAnimeClient();
const items = await client.search("药屋少女的呢喃");
const roads = await client.getRoads(items[0]!);
const episodes = await client.getEpisodes(items[0]!, roads[0]!);
const { filePath } = await client.download(episodes[0]!, {
  outputDir: "./downloads",
  rule: "AGE",
});
```

**在仓库内的验证方式:**

```powershell
pnpm --filter @sakurachiyo0v0/kazumi typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/kazumi test        # 单测(mock 站全链路 + 受限 JSONPath 沙箱 + 真实 ffmpeg 合并)
pnpm --filter @sakurachiyo0v0/kazumi build       # 构建 ESM + CJS + d.ts + CLI
pnpm verify:kazumi-package                        # pack 后从临时消费项目验证 ESM/CJS 导入 + CLI
```

**合规边界:** SDK 是中立规则引擎,不内置任何站点规则;不做任何站点绕过/伪装;`CAPTCHA` 只感知不规避。

**更多细节:** [`packages/kazumi/README.md`](../packages/kazumi/README.md)
