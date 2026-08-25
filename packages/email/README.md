# @sakurachiyo0v0/email

面向 Node.js 服务端的邮件发送 SDK。当前内置通用 SMTP 适配器，公共接口与具体服务商解耦，后续可以增加 Resend、SendGrid、AWS SES 等适配器。

## 环境要求

- Node.js 20 或更高版本
- 运行在可信任的服务端进程中；不要在浏览器或 WebView 中保存 SMTP 密码

## 安装

### 同一 pnpm workspace

```powershell
pnpm add @sakurachiyo0v0/email@workspace:*
```

### 从本地目录使用

先在 `ts-dev-kits` 中构建包：

```powershell
pnpm --filter @sakurachiyo0v0/email build
```

再在消费项目中添加本地依赖：

```powershell
pnpm add "file:C:/LocalSpace/Projects/ts-dev-kits/packages/email"
```

### 从 GitHub monorepo 使用

pnpm 11 默认禁止未经审核的 Git 依赖运行构建脚本。先在消费项目的 `pnpm-workspace.yaml` 中精确授权这个仓库：

```yaml
allowBuilds:
  '@sakurachiyo0v0/email@git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git': true
```

然后添加 monorepo 中的包目录：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/email"
```

本机 Git 需能访问 GitHub（仓库公开，无需额外授权）。生产项目建议把依赖固定到经过审核的提交：

```json
{
  "dependencies": {
    "@sakurachiyo0v0/email": "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#<commit-sha>&path:/packages/email"
  }
}
```

## SMTP 示例

```ts
import {
  createEmailClient,
  smtpProvider,
  type EmailError,
} from "@sakurachiyo0v0/email";

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

try {
  await client.verify();

  const result = await client.send({
    from: process.env.SMTP_FROM!,
    to: ["alice@example.com", { name: "Bob", address: "bob@example.com" }],
    replyTo: "support@example.com",
    subject: "SDK 测试邮件",
    text: "纯文本内容",
    html: "<h1>HTML 内容</h1><p>来自 @sakurachiyo0v0/email</p>",
    attachments: [
      {
        filename: "hello.txt",
        contentType: "text/plain",
        content: Buffer.from("hello"),
      },
    ],
    headers: {
      "X-Application": "example-service",
    },
  });

  console.log(result.messageId, result.accepted, result.rejected);
} catch (error) {
  const emailError = error as EmailError;
  console.error(emailError.code, emailError.message);
} finally {
  await client.close();
}
```

端口通常与加密方式配套：465 一般使用 `secure: true`，587/25 一般使用 `secure: false` 并由 SMTP 协商 STARTTLS。请以邮箱服务商文档为准。

### SMTP 参数

| 参数 | 必填 | 含义与默认行为 |
| --- | --- | --- |
| `host` | 是 | SMTP 主机名或 IP 地址 |
| `port` | 是 | 1–65535 的 SMTP 端口 |
| `secure` | 是 | `true` 表示连接建立时直接使用 TLS；`false` 允许普通连接后协商 STARTTLS |
| `auth.user` / `auth.pass` | 否 | SMTP 用户名和密码；提供 `auth` 时两者必须同时存在 |
| `tls.rejectUnauthorized` | 否 | 是否拒绝无法验证的 TLS 证书，Node.js 默认拒绝；不要在生产环境为方便而设为 `false` |
| `tls.servername` | 否 | TLS 证书校验使用的服务器名称；当 `host` 是 IP 时可能需要显式设置 |
| `tls.minVersion` | 否 | 最低 TLS 版本，可选 `TLSv1.2` 或 `TLSv1.3` |
| `pool` | 否 | 是否复用 SMTP 连接；默认不开启 |
| `maxConnections` | 否 | 连接池最大并发连接数；Nodemailer 默认 5，仅在连接池模式下生效 |
| `maxMessages` | 否 | 每条池连接最多处理的邮件数；Nodemailer 默认 100，仅在连接池模式下生效 |
| `connectionTimeoutMs` | 否 | 建立 TCP/TLS 连接的最长等待时间；Nodemailer 默认 120000 ms |
| `greetingTimeoutMs` | 否 | 连接后等待 SMTP greeting 的最长时间；Nodemailer 默认 30000 ms |
| `socketTimeoutMs` | 否 | 套接字无活动时的超时时间；Nodemailer 默认 600000 ms |

`verify()` 只检查连接和认证能力，不发送邮件。`send()` 每次只尝试一次，SDK 不自动重试：网络超时不能证明服务端未接受邮件，调用方盲目重试可能造成重复投递。使用连接池时，在进程退出或不再发送时调用 `close()`。

## 公共能力

- 收件人：`to`、`cc`、`bcc`、`replyTo`
- 正文：纯文本 `text`、HTML `html`，至少提供一种
- 附件：文件路径、`Buffer` 或 Node.js `Readable`
- 自定义邮件头
- `verify()` 连接检查、`send()` 发送、`close()` 资源释放
- 标准错误码：

| 错误码 | 含义 |
| --- | --- |
| `CONFIGURATION` | SMTP 或客户端配置无效 |
| `VALIDATION` | 邮件消息字段无效，尚未调用 provider |
| `AUTHENTICATION` | 凭据缺失或 SMTP 认证失败 |
| `CONNECTION` | DNS、套接字、超时、TLS 或 REQUIRETLS 连接失败 |
| `DELIVERY` | 收件人、消息内容、消息流或 SMTP 响应拒绝 |
| `UNKNOWN` | 尚未识别的底层错误；调用方应安全记录并人工判断 |

SDK 会过滤常见 SMTP 异常中的用户名和密码，但调用方仍不应记录错误的 `cause`、完整环境变量或原始 SMTP 配置。

## 自定义适配器

实现 `EmailProvider` 即可接入其他邮件服务：

```ts
import type { EmailProvider } from "@sakurachiyo0v0/email";

const provider: EmailProvider = {
  name: "custom",
  async verify() {},
  async send(message) {
    return {
      provider: "custom",
      messageId: "provider-message-id",
      accepted: [],
      rejected: [],
      response: "queued",
    };
  },
  async close() {},
};
```
