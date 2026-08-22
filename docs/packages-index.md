# ts-dev-kits 依赖包索引

本文件是仓库内所有可复用依赖包的总索引。维护原则：

- 新增一个依赖包时，在「总览」表格追加一行，并按照下文格式补一段「包详情」。
- 新建包的目录结构约定见 [`package-template.md`](package-template.md)。
- 表格中的「引用方式」列填写最常用的安装方式；完整选项见对应包的详情。

## 总览

| 包名 | 版本 | 用途 | 状态 | 引用方式 |
| --- | --- | --- | --- | --- |
| `@amechan/email` | 0.1.0 | 与供应商解耦的 Node.js 邮件 SDK | 可用（SMTP 适配器） | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/email` |
| `@amechan/ffmpeg` | 0.1.0 | FFmpeg/ffprobe 进程封装 + 媒体处理高层函数 | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/ffmpeg` |
| `@amechan/bilibili` | 0.1.0 | B 站视频下载 SDK(解析/取流/下载/ffmpeg 合并) | 可用(投稿视频) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/bilibili` |
| `@amechan/chat-platforms` | 0.1.0 | 统一聊天平台接入 SDK(消息模型/适配器注册表,当前飞书) | 可用(飞书, websocket/webhook) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/chat-platforms` |
| `@amechan/lol` | 0.1.0 | 英雄联盟 LCU 本地能力 SDK(召唤师/战绩/段位/对局流程/游戏数据/事件) | 可用(查询+对局感知, 国服 SGP) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/lol` |

## 包详情

### `@amechan/email`

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
pnpm add @amechan/email@workspace:*
```

从私有 GitHub monorepo 安装（需先在消费项目 `pnpm-workspace.yaml` 中授权构建脚本，见包内 README）：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/email"
```

生产项目建议固定到已审核提交：

```json
{
  "dependencies": {
    "@amechan/email": "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#<commit-sha>&path:/packages/email"
  }
}
```

**API 示例：**

```ts
import { createEmailClient, smtpProvider } from "@amechan/email";

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
pnpm --filter @amechan/email test   # 单测（本地 SMTP 协议路径）
pnpm --filter @amechan/email build  # 构建 ESM + CJS + d.ts
pnpm verify:email-package           # pnpm pack 后从临时消费项目导入
pnpm verify:email-git-package       # 以 git 子目录依赖方式安装并导入
```

**更多细节：** [`packages/email/README.md`](../packages/email/README.md)

### `@amechan/ffmpeg`

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
pnpm add @amechan/ffmpeg@workspace:*
```

从私有 GitHub monorepo 安装(需先在消费项目 `pnpm-workspace.yaml` 中授权构建脚本,见包内 README)：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/ffmpeg"
```

**API 示例：**

```ts
import { createFfmpegClient } from "@amechan/ffmpeg";

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
pnpm --filter @amechan/ffmpeg test   # 单测(真实 ffmpeg 生成视频 + 转码/截图/音频)
pnpm --filter @amechan/ffmpeg build  # 构建 ESM + CJS + d.ts
```

**更多细节：** [`packages/ffmpeg/README.md`](../packages/ffmpeg/README.md)

### `@amechan/bilibili`

B 站视频下载 SDK。解析视频信息、获取播放流、可配置下载器下载,并用 `@amechan/ffmpeg` 合并音视频。核心逻辑参考开源项目 [Bili23-Downloader](https://github.com/ScottSloan/Bili23-Downloader)。

**适用环境：** Node.js 20+,下载合并视频需系统安装 `ffmpeg`。

**核心接口：**

- `createBilibiliClient({ cookie?, authPath?, download?, merge? })` — 创建客户端;未传 cookie 时自动从登录态存储加载
- `client.parse(url)` — 解析 B 站链接,返回 `MediaItem[]`(第一版支持投稿视频/BV/av,其余类型第二版)
- `client.getStreams(item, { quality?, codec? })` — 获取 DASH/MP4 播放流,支持清晰度与编码选择
- `client.download(item, { outputDir, quality?, onProgress? })` — 下载并合并,返回文件路径
- 下载器可配置:并发数/分块大小/重试/限速/断点续传/CDN 过滤
- **扫码登录**:`amechan-bilibili login` 弹窗扫码,自动收集 cookie 持久化(`%APPDATA%` 等平台配置目录,权限 600);`status` / `logout` 管理登录态;cookie 过期用 refresh_token 自动续期
- `BilibiliError` — 统一错误码:`NETWORK` / `API_ERROR` / `INVALID_URL` / `LOGIN_REQUIRED` / `AUTH_EXPIRED` / `DOWNLOAD_FAILED` / `MERGE_FAILED` / `UNSUPPORTED_TYPE`

**WBI 签名内置**,自动处理 img_key/sub_key 获取与签名;高画质需登录(扫码登录或传入 Cookie)。

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @amechan/bilibili@workspace:*
```

从私有 GitHub monorepo 安装(需授权 `@amechan/bilibili` 与 `@amechan/ffmpeg` 两个构建脚本)：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/bilibili"
```

**API 示例：**

```ts
import { createBilibiliClient } from "@amechan/bilibili";
const bili = createBilibiliClient({ download: { concurrency: 4 } });
const items = await bili.parse("https://www.bilibili.com/video/BV1xx411c7mD");
await bili.download(items[0]!, { outputDir: "./downloads", quality: 80 });
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @amechan/bilibili test   # mock API 验证解析/取流/WBI/下载/清晰度选择
pnpm --filter @amechan/bilibili build  # 构建 ESM + CJS + d.ts
```

**更多细节：** [`packages/bilibili/README.md`](../packages/bilibili/README.md)

### `@amechan/chat-platforms`

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
pnpm add @amechan/chat-platforms@workspace:*
```

从私有 GitHub monorepo 安装（需授权 `@amechan/chat-platforms` 与 `@larksuiteoapi/node-sdk` 构建脚本）：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/chat-platforms"
```

**API 示例：**

```ts
import { ChatPlatformClient, feishuProvider } from "@amechan/chat-platforms";

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
pnpm --filter @amechan/chat-platforms test   # 单测（注册表/客户端/飞书事件解析/webhook challenge）
pnpm --filter @amechan/chat-platforms build  # 构建 ESM + CJS + d.ts
```

**更多细节：** [`packages/chat-platforms/README.md`](../packages/chat-platforms/README.md)

### `@amechan/lol`

英雄联盟（LoL）客户端本地能力 SDK。封装 LCU API（League Client Update，客户端暴露的本机 HTTP/WebSocket 接口），提供召唤师、战绩、段位、对局流程、选人、游戏数据等能力，供本机 Node 进程（Electron 主进程 / CLI / 本地 Web 后端）直接使用。代码完全自研（无 Seraphine 代码复制，规避 GPLv3），参考 LCU 官方文档与开源项目 [Seraphine](https://github.com/Zzaphkiel/Seraphine) 的设计思路。

**适用环境：** Node.js 20+，Windows 本机 + 运行中的英雄联盟客户端；LCU 只存在于本机客户端运行期间，**不能做成云端 SaaS**。

**核心接口：**

- `createLolClient({ connection?, concurrency?, timeoutMs? })` — 自动发现本机 LCU 并连接（也可显式指定连接参数）
- `client.summoner` — `getCurrent()` / `getByName()` / `getByPuuid()` / `getProfile()`
- `client.matchHistory` — `getMatches(puuid, {begIndex, endIndex})` / `getMatchesViaSgp()` / `getGameDetail(gameId)`
- `client.ranked` — `getStats(puuid)` / `getStatsViaSgp(puuid)`
- `client.gameflow` — `getPhase()` / `getSession()` / `getReadyCheck()` / `acceptReadyCheck()` / `dodge()` / `reconnect()` / `playAgain()` / `spectate()`
- `client.gameData` — 静态数据（英雄/物品/符文/召唤师技能/队列）与 `fetchAsset()` 资源获取
- `client.events` — WebSocket 事件订阅：`onGameflowPhase` / `onChampSelect` / `onCurrentSummoner` / `onSgpToken` / 通用 `subscribe()`
- `client.sgp` — 腾讯国服 SGP 通道（检测到国服服务器自动启用，非国服为 `undefined`）
- `LolError` — 统一错误码 `CLIENT_NOT_RUNNING` / `DISCOVERY_FAILED` / `CONNECTION` / `NOT_FOUND` / `RATE_LIMIT` / `AUTH` / `TIMEOUT` / `UNKNOWN`，消息脱敏

**关键机制：** tasklist + PowerShell CIM 进程发现；undici 忽略自签名证书 + BasicAuth；信号量限流 + GET 指数退避重试；WebSocket 断线自动重连；国服 SGP Bearer 通道。

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @amechan/lol@workspace:*
```

从私有 GitHub monorepo 安装（需在消费项目 `pnpm-workspace.yaml` 中授权 `@amechan/lol` 构建脚本）：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/lol"
```

**API 示例：**

```ts
import { createLolClient } from "@amechan/lol";

const client = await createLolClient();
const me = await client.summoner.getCurrent();
const games = await client.matchHistory.getMatches(me.puuid, { begIndex: 0, endIndex: 19 });
client.events.onGameflowPhase((phase) => console.log("阶段:", phase));
await client.close();
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @amechan/lol typecheck   # 类型检查
pnpm --filter @amechan/lol test        # 单测（本地 mock LCU 服务器，走真实 HTTP/WS 协议路径）
pnpm --filter @amechan/lol build       # 构建 ESM + CJS + d.ts
```

**更多细节：** [`packages/lol/README.md`](../packages/lol/README.md)；设计文档 [`docs/superpowers/specs/2026-08-22-lol-sdk-design.md`](superpowers/specs/2026-08-22-lol-sdk-design.md)
