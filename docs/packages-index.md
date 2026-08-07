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
| `@amechan/llm` | 0.1.0 | OpenAI 兼容多提供商 LLM 客户端(OpenAI/Anthropic/Gemini/Azure) | 可用 | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/llm` |
| `@amechan/bilibili` | 0.1.0 | B 站视频下载 SDK(解析/取流/下载/ffmpeg 合并) | 可用(投稿视频) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/bilibili` |
| `@amechan/chat-platforms` | 0.1.0 | 统一聊天平台接入 SDK(消息模型/适配器注册表,当前飞书) | 可用(飞书, websocket/webhook) | `git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/chat-platforms` |

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

### `@amechan/llm`

OpenAI 兼容的多提供商 LLM 客户端。统一接口调用主流模型提供商,内置格式转换、流式输出、工具调用与错误归一化,附带轻量 OpenAI 兼容 HTTP 代理。

**适用环境：** Node.js 20+,使用各提供商时需对应的 API Key。

**核心接口：**

- `createLlmClient({ adapter })` — 创建客户端
- `openaiAdapter({ apiKey, baseUrl?, ... })` / `anthropicAdapter({ apiKey })` / `geminiAdapter({ apiKey })` / `azureAdapter({ apiKey, baseUrl, deployment })` — 各家适配器
- `client.chat(request)` — 非流式补全,返回 OpenAI 兼容响应
- `client.chatStream(request, onChunk)` — 流式补全,逐块回调
- `createLlmProxy({ adapter, defaultModel? })` — 起 OpenAI 兼容 HTTP 服务
- `LlmError` — 统一错误类型,错误码 `AUTHENTICATION` / `RATE_LIMIT` / `TIMEOUT` / `INVALID_REQUEST` / `MODEL_NOT_FOUND` / `OVERLOADED` / `NETWORK` / `UNKNOWN`

**请求形态：** OpenAI 兼容(`model` + `messages`,支持 `temperature` / `maxTokens` / `tools` / `toolChoice` / 多模态图片 / 流式),响应归一为 OpenAI 格式。

**安装方式：**

同一 pnpm workspace 内：

```powershell
pnpm add @amechan/llm@workspace:*
```

从私有 GitHub monorepo 安装(需先在消费项目 `pnpm-workspace.yaml` 中授权构建脚本,见包内 README)：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/llm"
```

**API 示例：**

```ts
import { createLlmClient, openaiAdapter } from "@amechan/llm";

const client = createLlmClient({
  adapter: openaiAdapter({ apiKey: process.env.OPENAI_API_KEY! }),
});
const result = await client.chat({
  model: "gpt-4o",
  messages: [{ role: "user", content: "你好" }],
});
console.log(result.choices[0]?.message.content);
```

**在仓库内的验证方式：**

```powershell
pnpm --filter @amechan/llm test   # mock 服务器验证四家适配器转换/错误/流式/代理
pnpm --filter @amechan/llm build  # 构建 ESM + CJS + d.ts
```

**更多细节：** [`packages/llm/README.md`](../packages/llm/README.md)

### `@amechan/bilibili`

B 站视频下载 SDK。解析视频信息、获取播放流、可配置下载器下载,并用 `@amechan/ffmpeg` 合并音视频。核心逻辑参考开源项目 [Bili23-Downloader](https://github.com/ScottSloan/Bili23-Downloader)。

**适用环境：** Node.js 20+,下载合并视频需系统安装 `ffmpeg`。

**核心接口：**

- `createBilibiliClient({ cookie?, download?, merge? })` — 创建客户端
- `client.parse(url)` — 解析 B 站链接,返回 `MediaItem[]`(第一版支持投稿视频/BV/av,其余类型第二版)
- `client.getStreams(item, { quality?, codec? })` — 获取 DASH/MP4 播放流,支持清晰度与编码选择
- `client.download(item, { outputDir, quality?, onProgress? })` — 下载并合并,返回文件路径
- 下载器可配置:并发数/分块大小/重试/限速/断点续传/CDN 过滤
- `BilibiliError` — 统一错误码:`NETWORK` / `API_ERROR` / `INVALID_URL` / `LOGIN_REQUIRED` / `DOWNLOAD_FAILED` / `MERGE_FAILED` / `UNSUPPORTED_TYPE`

**WBI 签名内置**,自动处理 img_key/sub_key 获取与签名;高画质需传入登录 Cookie。

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

- `ChatPlatformClient` — 多平台客户端：`add(adapter)` / `remove(name)` / `send(source, message)` / `onMessage(handler)` / `disconnectAll()`
- `ChatPlatformAdapter` — 适配器统一接口：`connect({ onMessage })` / `disconnect()` / `send(source, message)` / `handleWebhook?(body)`
- `ChatPlatformRegistry` / `registerPlatform()` — 注册表 + 工厂
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
