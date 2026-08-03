# 邮件发送代码配方

让 AI 直接使用 `nodemailer` 库发送邮件。本 skill 不依赖本仓库的 `@amechan/email` 包,给出的是任何 Node.js 项目都能直接运行的通用代码。若项目已安装 `@amechan/email`,可直接跳到文末「使用 @amechan/email」小节。

## 环境检查

```bash
node -v   # 需 Node.js 18+
```

未安装 nodemailer 时:

```bash
npm install nodemailer        # 或 pnpm add nodemailer
```

## 核心流程

发送邮件固定三步:**创建 transport → 发送 → 关闭**。

```ts
import nodemailer from "nodemailer";

// 1. 创建 transport(凭据从环境变量读取,不要硬编码)
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,          // 如 smtp.gmail.com / smtp.qq.com
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,    // 多数服务商用"应用专用密码"
  },
});

try {
  // 2. 发送
  const info = await transport.sendMail({
    from: process.env.SMTP_FROM,        // 必填
    to: ["a@example.com", "b@example.com"],
    cc: "cc@example.com",
    bcc: "bcc@example.com",
    replyTo: "support@example.com",
    subject: "测试邮件",                 // 必填
    text: "纯文本内容",                   // text 与 html 至少一个
    html: "<h1>HTML</h1><p>内容</p>",
    attachments: [
      { filename: "hello.txt", contentType: "text/plain", content: Buffer.from("hello") },
    ],
    headers: { "X-Application": "example-service" },
  });

  console.log(info.messageId, info.accepted, info.rejected);
} finally {
  // 3. 关闭连接(长连接/进程退出前必须调用)
  await transport.close();
}
```

## 端口与 secure 配对

| 端口 | secure | 说明 |
| --- | --- | --- |
| 465 | `true` | 连接即 TLS |
| 587 / 25 | `false` | 普通连接后 STARTTLS(常用) |

以邮件服务商文档为准。

## 常用服务商配置

```ts
// Gmail(需开启两步验证 + 应用专用密码)
{ host: "smtp.gmail.com", port: 465, secure: true }

// QQ 邮箱(需生成授权码)
{ host: "smtp.qq.com", port: 465, secure: true }

// Outlook / Office 365
{ host: "smtp.office365.com", port: 587, secure: false }

// 阿里云企业邮箱
{ host: "smtp.mxhichina.com", port: 465, secure: true }
```

## 任务配方

### 简单文本邮件

```ts
await transport.sendMail({
  from: "a@example.com",
  to: "b@example.com",
  subject: "Hello",
  text: "Hi!",
});
```

### 带附件邮件

```ts
await transport.sendMail({
  from: "a@example.com",
  to: "b@example.com",
  subject: "Report",
  text: "See attached",
  attachments: [
    { filename: "report.pdf", path: "/tmp/report.pdf" },   // 路径
    { filename: "note.txt", content: Buffer.from("inline") }, // 内存内容
    { filename: "image.png", path: "https://example.com/a.png" }, // URL
  ],
});
```

### 发 HTML 邮件(营销样式)

```ts
await transport.sendMail({
  from: '"No Reply" <noreply@example.com>',
  to: ["user@example.com"],
  subject: "Weekly digest",
  html: `<h1>本周摘要</h1><a href="https://example.com">查看详情</a>`,
});
```

### 发送前验证配置

```ts
try {
  await transport.verify();           // 验证连接与认证
  console.log("SMTP 连接正常");
} catch (error) {
  console.error("配置有误:", error.message);
}
```

### 批量发送(逐个,带间隔)

```ts
for (const email of recipients) {
  await transport.sendMail({ from, to: email, subject, text });
  await new Promise((r) => setTimeout(r, 1000));  // 避免被限流
}
```

### 使用连接池(高频发送)

```ts
const transport = nodemailer.createTransport({
  host, port, secure,
  auth: { user, pass },
  pool: true,              // 复用连接
  maxConnections: 5,       // 最大并发连接
  maxMessages: 100,        // 每条连接最多发送数
});
```

## 错误处理

nodemailer 的错误是原生 Error,判断方式:

```ts
try {
  await transport.sendMail(...);
} catch (error) {
  const e = error as NodeJS.ErrnoException;
  // e.code: EAUTH(认证失败) / ECONNECTION(连接失败) / ETIMEDOUT(超时) 等
  if (e.code === "EAUTH") console.error("用户名/密码错误");
  else console.error("发送失败:", e.message);
  // 注意:错误对象里可能包含 SMTP 响应,不要整段记录到日志(可能含敏感信息)
}
```

## 陷阱清单

- **不要硬编码密码**:从环境变量/配置系统读取,不写进代码、日志、错误输出。
- **多数邮箱服务商要求"应用专用密码"或"授权码"**,不是邮箱登录密码。
- **`text` 与 `html` 至少提供一种**,否则可能发送空邮件或失败。
- **`attachments` 的 `path` 与 `content` 二选一**,不要同时给。
- **发送失败不等于邮件没送达**:SMTP 已接受但网络中断等边界情况可能重复。生产环境需要幂等/去重机制。
- **不要盲目自动重试**:网络超时不能证明邮件未送达,盲目重试会造成重复投递。
- **端口/secure 配对错会连接失败**:465→true,587/25→false。
- **长连接用完要 `close()`**,否则进程可能不退出或连接泄漏。

## 使用 @amechan/email(可选)

若项目已安装 `@amechan/email` 包,接口更统一,错误有分类:

```ts
import { createEmailClient, smtpProvider, EmailError } from "@amechan/email";

const email = createEmailClient({
  provider: smtpProvider({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
  }),
});

await email.verify();
const result = await email.send({
  from: process.env.SMTP_FROM!,
  to: ["a@example.com"],
  subject: "Hello",
  text: "Hi!",
});
await email.close();
```

错误码:`CONFIGURATION` / `VALIDATION` / `AUTHENTICATION` / `CONNECTION` / `DELIVERY` / `UNKNOWN`,并自动对凭据脱敏。安装方式见仓库 `packages/email/README.md`。

## 验证

- 先发给自己测试,确认收到后再发真实收件人。
- 检查 `info.accepted`(成功收件人)与 `info.rejected`(被拒收件人)。
- 本地自动化测试可用 `smtp-server` 包起测试服务器。
