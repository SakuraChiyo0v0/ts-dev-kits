# @amechan/chat-platforms

统一聊天平台接入 SDK（第一版：飞书）。核心设计参考 [AstrBot](https://github.com/Soulter/AstrBot) 与 [hermes-agent](https://github.com/NousResearch/hermes-agent) 的平台适配架构：**平台差异在适配器内消化，上层只面对统一消息模型**。新增平台 = 实现一个适配器 + 注册，核心零改动。

**适用环境：** Node.js 20+，运行在可信任的服务端进程（含 Electron 主进程）。**不要在浏览器/WebView 中保存应用凭证。**

## 核心概念

- **`ChatSource`** —— 会话来源，定位"消息来自哪个平台的哪个会话"，平台无关，用于会话隔离。
- **`ChatMessage`** —— 入站消息（平台事件归一化后）：文本内容 + 来源 + 原始事件。
- **`ChatMessageOutbound`** —— 出站消息（回复/主动推送）。
- **`ChatPlatformAdapter`** —— 平台适配器统一接口：`connect` / `disconnect` / `send` / `handleWebhook?`。
- **`ChatPlatformRegistry`** —— 适配器注册表（工厂模式，新增平台零改核心）。
- **`ChatPlatformClient`** —— 多平台客户端：统一管理所有已启用平台 + 统一入站路由。
- **`ChatResponsePolicy`** —— 消息响应策略（平台无关）：白名单/黑名单/唤醒词/关键词屏蔽/限流/表情回应，参考 AstrBot `platform_settings` 设计。

## 响应策略（白名单 / 表情 / 唤醒）

`ChatResponsePolicy` 控制"哪些消息值得响应"，在 `ChatPlatformClient.add(adapter, policy)` 时注入，收到消息先过策略再回调：

```ts
import { ChatPlatformClient, feishuProvider, defaultPolicy } from "@amechan/chat-platforms";

const policy = {
  ...defaultPolicy(),
  enableWhitelist: true,
  userWhitelist: ["ou_xxx"],       // 用户白名单
  groupWhitelist: ["oc_xxx"],      // 群白名单
  adminUserIds: ["ou_admin"],      // 管理员（豁免白名单）
  replyWhenBlocked: true,          // 被拦时回复提示
  blockedReplyText: "我没有权限与你对话。",
  groupWakePrefixes: ["/h"],       // 群聊唤醒词：/h 开头才响应
  blockedKeywords: ["广告", "垃圾"], // 关键词屏蔽
  rateLimit: { windowSeconds: 60, maxMessages: 30 }, // 限流
  emojiReaction: { enabled: true, emojis: ["👍", "🤔"] }, // 表情回应
};

const client = new ChatPlatformClient();
client.onMessage(async (m) => { /* 收到可响应消息 */ });
client.onBlocked(async (m, replyText) => { /* 被拦截时可发提示 */ });
await client.add(feishuProvider({ appId, appSecret }), policy);
```

**判定顺序**：黑名单 → 白名单（管理员豁免）→ 唤醒词 → 关键词屏蔽 → 限流 → 表情回应。

**策略字段：**

| 字段 | 说明 |
| --- | --- |
| `enableWhitelist` | 启用白名单（启用后仅白名单可对话） |
| `userWhitelist` | 用户白名单（userId，全局适用） |
| `groupWhitelist` | 群白名单（chatId，群聊适用） |
| `userBlacklist` / `groupBlacklist` | 用户/群黑名单（命中直接忽略） |
| `adminUserIds` | 管理员（豁免白名单） |
| `ignoreAdminInGroup` / `ignoreAdminInPrivate` | 管理员豁免开关 |
| `replyWhenBlocked` + `blockedReplyText` | 被拦截时是否回复提示 |
| `groupWakePrefixes` | 群聊唤醒词（前缀匹配，命中后剥掉前缀） |
| `privateNeedsWakePrefix` | 私聊是否也需唤醒词 |
| `ignoreBotSelf` / `ignoreAtAll` | 忽略自身/@全体消息 |
| `blockedKeywords` | 关键词屏蔽 |
| `rateLimit` | 限流（`{windowSeconds, maxMessages}`，null=不限） |
| `emojiReaction` | 表情回应（`{enabled, emojis}`，随机选一个） |

## 安装

同一 pnpm workspace 内：

```powershell
pnpm add @amechan/chat-platforms@workspace:*
```

从私有 GitHub monorepo 安装（需在消费项目 `pnpm-workspace.yaml` 授权构建脚本）：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/chat-platforms"
```

## 快速开始（飞书）

### 1. 配置飞书开放平台

1. 在 [飞书开放平台](https://open.feishu.cn) 创建企业自建应用，开启**机器人**能力。
2. 权限：`im:message`（读取与发送消息）、`im:message:send_as_bot`（以机器人身份发消息）。
3. 事件订阅：添加 `im.message.receive_v1`（接收消息）事件。
   - 长连接模式：在「事件与回调」页开启**使用长连接接收事件**。
   - webhook 模式：配置回调地址，开启**加密**（encrypt key）或**校验请求**（verification token）。
4. 发布应用版本并开通权限。

### 2. 代码接入

```ts
import {
  ChatPlatformClient,
  feishuProvider,
  registerFeishuPlatform,
} from "@amechan/chat-platforms";

// 方式一：直接创建适配器
const client = new ChatPlatformClient();
client.onMessage(async (message) => {
  // 收到飞书消息
  await client.send(message.source, { text: "收到：" + message.text });
});

await client.add(
  feishuProvider({
    appId: process.env.FEISHU_APP_ID!,
    appSecret: process.env.FEISHU_APP_SECRET!,
    transport: "websocket", // 或 "webhook"
    // webhook 模式需要：
    // verificationToken: process.env.FEISHU_VERIFICATION_TOKEN!,
    // encryptKey: process.env.FEISHU_ENCRYPT_KEY!,
  }),
);

// 方式二：通过注册表 + 工厂
registerFeishuPlatform();
// const adapter = defaultRegistry.create("feishu", { ... });
```

### 3. webhook 模式接线

webhook 模式下，你需要在自己的 HTTP 服务里接收飞书回调，并转发给适配器：

```ts
import http from "node:http";
import { feishuProvider } from "@amechan/chat-platforms";

const adapter = feishuProvider({ appId, appSecret, transport: "webhook", encryptKey });
await adapter.connect({ onMessage: (m) => console.log(m) });

http
  .createServer(async (req, res) => {
    if (req.url === "/webhook/feishu" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const result = await adapter.handleWebhook!(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.challenge ? { challenge: result.challenge } : {}));
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(8080);
```

> 注意：飞书 webhook 的验签（verification token / encrypt key 校验）在真实场景中需按飞书文档实现，或使用 SDK 的 `adaptDefault` / `EventDispatcher` 辅助。本包当前 `handleWebhook` 处理明文事件；加密事件解密与验签在后续版本补齐。

## 配置参数（飞书）

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `appId` | string | ✅ | 应用 App ID（`cli_xxx`） |
| `appSecret` | string | ✅ | 应用 App Secret |
| `transport` | `"websocket" \| "webhook"` | 否 | 事件接收方式，默认 `websocket` |
| `verificationToken` | string | webhook 时 | 事件校验 token |
| `encryptKey` | string | webhook 时 | 事件加密 key（与 verificationToken 至少一个） |
| `enablePrivateChat` | boolean | 否 | 是否响应私聊（默认 true） |

## 统一错误

`ChatPlatformError`，错误码：

| 错误码 | 含义 |
| --- | --- |
| `CONFIGURATION` | 配置缺失/非法 |
| `VALIDATION` | 输入校验失败 |
| `AUTHENTICATION` | 认证失败（token/权限） |
| `CONNECTION` | 连接失败（网络/WS） |
| `DELIVERY` | 发送失败 |
| `NOT_FOUND` | 目标不存在（群/用户） |
| `UNKNOWN` | 其他 |

## 新增平台

1. 在 `src/providers/<platform>/` 下实现 `ChatPlatformAdapter`。
2. 提供 `<platform>Provider(config)` 工厂 + 配置校验函数。
3. 在 `src/index.ts` 导出，并写 `register<Platform>Platform()` 注册到默认注册表。
4. 参照飞书测试补充事件解析单测。

## 验证

```powershell
pnpm --filter @amechan/chat-platforms typecheck  # 类型检查
pnpm --filter @amechan/chat-platforms test       # 单测
pnpm --filter @amechan/chat-platforms build      # 构建 ESM + CJS + d.ts
```
