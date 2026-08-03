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

## 对应能力手册(skills)

每个能力手册是不依赖安装的直接使用指南,AI 加载后即可照着执行:

| skill | 形态 | 用途 |
| --- | --- | --- |
| [`skills/ffmpeg`](../skills/ffmpeg/SKILL.md) | 纯命令配方 | AI 直接用系统 `ffmpeg`/`ffprobe` 处理音视频与图片,无需安装任何包 |
| [`skills/email`](../skills/email/SKILL.md) | 通用代码配方 | AI 直接用 `nodemailer` 发送邮件,无需安装本仓库包 |

使用方项目可将 `skills/` 目录复制到自己的 skills 目录,或直接参考对应 SKILL.md。新增包时按 AGENTS.md 约定补充对应 skill。
