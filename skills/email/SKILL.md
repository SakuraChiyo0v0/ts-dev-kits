# 邮件发送

让 AI 直接调用 `@amechan/email` 包的功能发送邮件:连接验证、发送文本/HTML 邮件、附件、自定义头。AI 使用统一 API,不直接拼 nodemailer 参数。

## 环境检查

- Node.js >= 20。
- 需要可用的 SMTP 服务商账号(主机、端口、用户名、密码或应用专用密码)。

## 是否已安装本包?

在项目 `package.json` 中查找 `@amechan/email`:

- **已安装**:直接 `import { createEmailClient, smtpProvider } from "@amechan/email"`,跳过安装。
- **未安装但项目在 ts-dev-kits monorepo 内**:`pnpm add @amechan/email@workspace:*`。
- **未安装且在外部项目**:
  1. 在消费项目 `pnpm-workspace.yaml` 添加授权:
     ```yaml
     allowBuilds:
       '@amechan/email@git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git': true
     ```
  2. `pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/email"`
- **无法安装包时**:降级直接用 nodemailer(见「无包降级」)。

## 核心流程

发邮件固定三步:**创建 → 发送(可选先 verify)→ close**。

```ts
import { createEmailClient, smtpProvider } from "@amechan/email";

// 1. 创建客户端(凭据从环境变量/配置系统读取,不要硬编码)
const email = createEmailClient({
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

try {
  // 2a.(可选)先验证连接与认证
  await email.verify();

  // 2b. 发送
  const result = await email.send({
    from: process.env.SMTP_FROM!,           // 必填
    to: ["alice@example.com", { name: "Bob", address: "bob@example.com" }],
    cc: ["cc@example.com"],
    bcc: ["bcc@example.com"],
    replyTo: "support@example.com",
    subject: "测试邮件",                     // 必填
    text: "纯文本内容",                       // text 与 html 至少一个
    html: "<h1>HTML</h1><p>内容</p>",
    attachments: [
      { filename: "hello.txt", contentType: "text/plain", content: Buffer.from("hello") },
    ],
    headers: { "X-Application": "example-service" },
  });

  console.log(result.messageId, result.accepted, result.rejected);
} finally {
  // 3. 释放连接(使用连接池或进程退出前必须调用)
  await email.close();
}
```

## API 速查

### 创建

- `createEmailClient({ provider })` — 创建客户端。
- `smtpProvider({ host, port, secure, auth?, tls?, pool?, maxConnections?, maxMessages?, connectionTimeoutMs?, greetingTimeoutMs?, socketTimeoutMs? })` — SMTP 适配器。

端口与 `secure` 配对(以服务商文档为准):

| 端口 | secure | 说明 |
| --- | --- | --- |
| 465 | `true` | 连接即 TLS |
| 587 / 25 | `false` | 普通连接后 STARTTLS |

### 发送参数 `send(message)`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `from` | 是 | 发件人,字符串或 `{ name, address }` |
| `to` / `cc` / `bcc` / `replyTo` | 否 | 收件人,字符串 / 对象 / 数组 |
| `subject` | 是 | 主题,不能含换行 |
| `text` / `html` | 至少一个 | 正文 |
| `attachments` | 否 | `{ filename, contentType?, cid?, path? 或 content? }`(path 与 content 二选一) |
| `headers` | 否 | 自定义头,值可为字符串或字符串数组 |

### 返回 `EmailSendResult`

`{ provider, messageId, accepted: string[], rejected: string[], response }`

### 生命周期

- `email.verify()` — 只验证连接与认证,不发送邮件。
- `email.send(message)` — 发送,只尝试一次,SDK 不自动重试。
- `email.close()` — 释放底层连接,使用连接池或进程退出前调用。

## 错误处理

统一 `EmailError`,错误码:

| 错误码 | 含义 | 常见原因 |
| --- | --- | --- |
| `CONFIGURATION` | 配置无效 | SMTP host/port/auth 缺失 |
| `VALIDATION` | 消息字段无效 | 收件人为空、subject 含换行、附件缺 path/content |
| `AUTHENTICATION` | 认证失败 | 用户名/密码错误 |
| `CONNECTION` | 连接失败 | DNS、超时、TLS、服务器不可达 |
| `DELIVERY` | 投递被拒 | 收件人不存在、邮件被服务器拒绝 |
| `UNKNOWN` | 未能分类 | 底层异常 |

```ts
import { EmailError } from "@amechan/email";
try {
  await email.send(message);
} catch (error) {
  const e = error as EmailError;
  console.error(e.code, e.message);   // 如 "AUTHENTICATION", "Invalid login"
}
```

## 任务配方

### 发送简单文本邮件

```ts
await email.send({ from: "a@example.com", to: "b@example.com", subject: "Hello", text: "Hi!" });
```

### 发送带附件邮件

```ts
await email.send({
  from: "a@example.com",
  to: "b@example.com",
  subject: "Report",
  text: "See attached",
  attachments: [
    { filename: "report.pdf", path: "/tmp/report.pdf" },
    { filename: "note.txt", content: Buffer.from("inline note") },
  ],
});
```

### 发 HTML 营销样式邮件

```ts
await email.send({
  from: "noreply@example.com",
  to: ["user@example.com"],
  subject: "Weekly digest",
  html: `<h1>本周摘要</h1><a href="https://example.com">查看详情</a>`,
});
```

### 发信前先验证配置

```ts
try {
  await email.verify();
  console.log("SMTP 连接正常");
} catch (error) {
  console.error("配置有误:", (error as EmailError).code);
}
```

## 陷阱清单

- **不要硬编码 SMTP 密码**。从环境变量或配置系统读取,不写进代码/日志/错误输出。
- **端口与 secure 要配对**:465 用 `secure: true`,587/25 用 `false`。配错会连接失败。
- **`send` 不自动重试**:网络超时不能证明邮件未送达,盲目重试会造成重复投递。需要重试时由上层自行设计幂等。
- **`text` 与 `html` 至少提供一种**,否则抛 `VALIDATION`。
- **`attachments` 的 `path` 与 `content` 二选一**,两者都缺或都有会抛 `VALIDATION`。
- **密码会脱敏**:SDK 会对错误消息中的凭据做 `[REDACTED]`,但调用方仍不应记录错误对象的 `cause`、完整环境变量或原始 SMTP 配置。
- **长连接用完要 `close()`**:使用连接池(`pool: true`)或长时间运行的服务,进程退出前必须 `await email.close()`。
- **SDK 不自动读 `.env`**:由调用方显式传入配置,避免隐藏的全局行为。

## 无包降级

包不可用时,直接用 nodemailer:

```ts
import nodemailer from "nodemailer";
const transport = nodemailer.createTransport({
  host, port, secure,
  auth: { user, pass },
});
const info = await transport.sendMail({ from, to, subject, text, html, attachments });
await transport.close();
```

注意:直接使用 nodemailer 时错误结构、脱敏、校验需自行处理。

## 验证

- `email.verify()` 成功 = 连接与认证正常。
- `send` 返回的 `accepted` 数组包含成功收件人,`rejected` 应为空(正常情况)。
- 可先发给自己测试,确认收到后再发真实收件人。
- 自动化验证可用本地 `smtp-server` 起测试服务器(见仓库 `packages/email/tests/helpers/smtp-test-server.ts`)。
