# `@sakurachiyo0v0/email` 邮件 SDK 设计

状态：用户已批准
日期：2026-08-03

## 1. 当前问题与目标

当前仓库尚无可复用的邮件发送能力。不同项目如果各自直接调用 Nodemailer，容易重复处理 SMTP 配置、收件人格式、附件、错误分类和敏感信息保护；未来改用 Resend、SendGrid 或 AWS SES 时，上层代码也会被具体供应商绑定。

本次目标是在 `ts-dev-kits` monorepo 中创建 `@sakurachiyo0v0/email`：

- 第一版通过通用 SMTP 真实发送邮件；
- 对业务代码提供与供应商无关的调用接口；
- 支持常用邮件字段、附件、连接验证和连接关闭；
- 提供一个仅限本机访问的 HTML 演示应用，可验证连接并真实发送邮件；
- 保持适配器边界，使未来增加 Resend、SendGrid 和 AWS SES 时无需修改上层调用方式。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 每个项目自行配置 SMTP 和 Nodemailer | 项目统一调用 `@sakurachiyo0v0/email` |
| 错误结构和敏感信息处理不一致 | SDK 返回统一、脱敏的错误 |
| 没有独立验证方式 | 可通过自动化测试和本地 HTML 演示验证 |
| 更换邮件服务商需要修改业务代码 | 新服务商通过 `EmailProvider` 适配器接入 |

## 3. 方案选择

### 方案 A：只封装 Nodemailer

直接导出 `sendMail()`，实现最少，但公共接口仍会暴露 Nodemailer 类型，未来接入 API 服务商时容易发生破坏性修改。

### 方案 B：供应商无关接口加 SMTP 适配器（采用）

业务代码只面对 `EmailClient` 和统一消息类型。SMTP 由第一个 `EmailProvider` 实现，未来服务商作为新适配器加入。该方案比薄封装多一层接口，但能提供稳定的长期复用边界。

### 方案 C：完整邮件平台

同时实现模板、队列、定时发送、投递记录和后台管理。功能更完整，但会引入数据库、任务调度、幂等和运维问题，超出“开发常用 SDK”的范围。

## 4. 仓库结构

```text
ts-dev-kits/
├─ packages/
│  └─ email/
│     ├─ src/
│     │  ├─ client.ts
│     │  ├─ errors.ts
│     │  ├─ index.ts
│     │  ├─ types.ts
│     │  └─ providers/
│     │     └─ smtp/
│     │        ├─ index.ts
│     │        ├─ smtp-provider.ts
│     │        └─ smtp-types.ts
│     ├─ tests/
│     ├─ package.json
│     └─ tsconfig.json
├─ examples/
│  └─ email-demo/
│     ├─ public/
│     │  ├─ app.js
│     │  ├─ index.html
│     │  └─ styles.css
│     ├─ src/
│     │  ├─ config.ts
│     │  ├─ index.ts
│     │  └─ server.ts
│     ├─ tests/
│     │  └─ server.test.ts
│     ├─ .env.example
│     └─ package.json
├─ docs/
├─ package.json
├─ pnpm-workspace.yaml
└─ tsconfig.base.json
```

`examples/email-demo` 是私有 workspace 包，不对外发布。它通过 `workspace:*` 使用 `@sakurachiyo0v0/email`，也承担代表性集成验证。

## 5. SDK 公共接口

典型调用方式：

```ts
import { createEmailClient, smtpProvider } from "@sakurachiyo0v0/email";

const email = createEmailClient({
  provider: smtpProvider({
    host: process.env.SMTP_HOST!,
    port: 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASSWORD!,
    },
  }),
});

await email.verify();

const result = await email.send({
  from: "Ame <noreply@example.com>",
  to: ["user@example.com"],
  subject: "测试邮件",
  text: "纯文本内容",
  html: "<h1>HTML 内容</h1>",
});

await email.close();
```

核心接口：

```ts
interface EmailProvider {
  readonly name: string;
  verify(): Promise<void>;
  send(message: EmailMessage): Promise<EmailSendResult>;
  close(): Promise<void>;
}
```

`EmailMessage` 第一版支持：

- `from`、`to`、`cc`、`bcc` 和 `replyTo`；
- `subject`；
- `text` 与 `html`，至少提供其中一个；
- 附件的文件路径、Buffer 或流；
- 合法的自定义邮件头。

`EmailSendResult` 返回：

- 供应商名称；
- 邮件 `messageId`；
- 已接受和被拒绝的收件人；
- SMTP 服务器响应。

SMTP 配置支持主机、端口、安全连接、认证、TLS 选项、连接超时和可选连接池。SDK 不自动读取 `.env`，由调用方显式传入配置，避免隐藏的全局行为。

## 6. 数据流与安全边界

### SDK

1. 调用方从系统环境或自己的配置系统读取 SMTP 凭据。
2. `EmailClient` 校验统一消息结构。
3. SMTP 适配器将消息转换为 Nodemailer 输入并发送。
4. 适配器把供应商返回值或错误转换为统一结果。

SDK 仅支持 Node.js 20 及以上。它不在浏览器或 Tauri WebView 中运行。Tauri 应通过远程后端或 Node sidecar 调用；TypeScript SDK 不能直接在 Rust 后端中执行。

### HTML 演示应用

1. `pnpm email:demo` 启动本地 Node 服务，并只监听 `127.0.0.1`。
2. Node 服务读取 `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASSWORD` 和可选的 `SMTP_FROM`。
3. 浏览器页面通过同源 API 请求执行连接验证和发送。
4. SMTP 密码不写入 HTML、不返回浏览器、不写入日志，也不持久化。
5. 服务拒绝非本机 Host 和非同源 Origin，不启用跨域访问。
6. 附件从浏览器提交后只在当前请求内保存在内存中；限制单文件和总请求大小，发送结束后立即释放。

演示应用提供：

- SMTP 配置状态提示，可回显非敏感的默认发件人，但不显示主机、账号或密码；
- 连接验证；
- `to`、`cc`、`bcc`、`replyTo`、主题、纯文本和 HTML 编辑；
- 附件选择；
- 真实发送；
- 脱敏后的发送结果和错误展示。

演示应用不是公网邮件后台，不提供登录、远程访问或多用户能力。

## 7. 错误处理

SDK 使用统一的 `EmailError`，错误类别包括：

- `CONFIGURATION`：SMTP 配置缺失或冲突；
- `VALIDATION`：邮件字段不合法；
- `AUTHENTICATION`：SMTP 认证失败；
- `CONNECTION`：DNS、网络、TLS 或超时失败；
- `DELIVERY`：服务器拒绝收件人或邮件；
- `UNKNOWN`：未能可靠分类的异常。

错误可以保留原始异常作为 `cause` 供服务端调试，但公开消息、JSON 响应和日志不得包含密码、认证令牌或完整连接字符串。

`send()` 默认不自动重试。网络超时不能证明服务器未接收邮件，自动重试可能造成重复投递。需要重试或幂等时，应由未来的队列层单独设计。

## 8. 构建与分发

- 包名为 `@sakurachiyo0v0/email`；
- 输出 ESM、CommonJS 和 TypeScript 声明；
- 仅发布构建产物、README 和许可证所需文件；
- 本地开发使用 pnpm workspace 或目录依赖；
- 远程使用可通过 Git 标签和 `path:/packages/email` 安装；
- 将来可无破坏性地发布到 Verdaccio 等 npm-compatible 私有仓库。

GitHub 仓库为公开的 `SakuraChiyo0v0/ts-dev-kits`。提交、推送和发布仍是彼此独立的授权阶段。

## 9. 测试与验证

### 自动化测试

- 类型与输入校验；
- SMTP 配置映射；
- 文本、HTML、抄送、密送、回复地址和附件发送；
- 认证、连接、校验和投递错误分类；
- 错误与日志中的凭据脱敏；
- `verify()` 与 `close()` 生命周期；
- 使用仅在测试进程中运行的本地 SMTP 服务器验证真实协议路径；
- 演示 API 的同源限制、请求大小限制和脱敏响应；
- ESM、CommonJS 和类型声明构建；
- `pnpm pack` 后从临时消费项目安装并导入。

### 代表性手动验证

1. 使用测试 SMTP 环境变量启动演示应用。
2. 在浏览器中验证连接。
3. 发送一封包含 HTML 和附件的邮件。
4. 核对收件结果和页面展示。
5. 使用错误密码验证错误分类及凭据未泄露。

真实外部投递需要用户提供测试 SMTP 账号和收件地址，并在执行前单独确认；没有这些信息时，完成标准以本地 SMTP 集成路径为准。

## 10. 非目标

第一版不包含：

- 模板引擎；
- 批量营销邮件；
- 队列、定时任务和自动重试；
- 投递历史数据库；
- 打开率或点击率追踪；
- 浏览器直连 SMTP；
- 公网部署演示应用；
- Resend、SendGrid 或 AWS SES 的实际适配器。

## 11. 验收条件

- Node.js 项目可以导入 `@sakurachiyo0v0/email`，完成连接验证和 SMTP 发送；
- 上层调用只依赖统一接口，不依赖 Nodemailer 类型；
- 常用消息字段和附件可以通过自动化测试发送到本地 SMTP 服务器；
- 所有公开错误和演示 API 响应不包含 SMTP 密码；
- HTML 演示只在本机开放，并能通过同源 API 真实调用 SDK；
- 构建、类型检查、测试和打包验证全部通过；
- 未引入模板、队列、远程管理等范围外能力。
