# @sakurachiyo0v0/vrchat

VRChat 官方 REST API SDK:认证(密码 + 2FA)、用户、世界、头像、实例、好友、通知等能力,分阶段交付。基于 [`@sakurachiyo0v0/account`](../account/README.md) 的密码登录骨架。

**适用环境:** Node.js 20+,运行在用户机器或服务器上的 Node 进程。凭证只保存 cookie,不保存密码。

## 安装

同一 pnpm workspace 内:

```powershell
pnpm add @sakurachiyo0v0/vrchat@workspace:*
```

从私有 GitHub monorepo 安装(需在消费项目 `pnpm-workspace.yaml` 中授权 `@sakurachiyo0v0/vrchat` 与 `@sakurachiyo0v0/account` 构建脚本):

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/vrchat"
```

## 快速开始

```ts
import { createVrchatClient } from "@sakurachiyo0v0/vrchat";

const client = await createVrchatClient();

// 登录(密码 + 可选 2FA),成功持久化到 AuthStore
await client.login({
  username: "your-username",
  password: "your-password",
  onNeedCode: async (info) => {
    console.log(info.message); // 2FA 提示(邮箱验证码 / TOTP)
    return "123456"; // 从你的输入渠道获取验证码
  },
});

const me = await client.auth.currentUser();
console.log(me.displayName);

await client.logout();
await client.close();
```

未登录时调用 API 抛 `VrchatError("AUTH_EXPIRED", ...)`,重新 `login()` 即可。

## 认证协议

| 步骤 | 端点 | 说明 |
| --- | --- | --- |
| 1 | `GET /auth/user`(Basic Auth,凭证 URL 编码) | 提交用户名密码;若返回 `requiresTwoFactorAuth` 则需 2FA(官方登录是 GET 而非 POST,POST 返回 405);此响应 `Set-Cookie: auth=authcookie_*` 即**最终会话 cookie** |
| 2 | `POST /auth/twofactorauth/{emailotp\|totp}/verify` | 提交验证码(body `{ code }`);成功后会话 cookie 仍为第 1 步的 `auth=...`(verify 响应只发 `twoFactorAuth` 票据,不作会话凭证) |
| 3 | `GET /auth/user` | 会话检查 / 当前用户 |
| 4 | `PUT /logout` | 登出 |

凭证 = `{ authCookie: string }`,经 AuthStore 落盘(`<配置根>/amechan/vrchat/auth.json`,600 权限)。

## API

### 客户端

```ts
createVrchatClient(options?: VrchatClientOptions): Promise<VrchatClient>
```

| 选项 | 类型 | 说明 |
| --- | --- | --- |
| `authPath` | `string` | AuthStore 自定义路径 |
| `cookie` | `string` | 显式会话 cookie(优先于 AuthStore) |
| `baseUrl` | `string` | 覆盖 API 基地址(测试用 mock) |
| `fetchImpl` | `typeof fetch` | 注入 fetch(测试用) |
| `timeoutMs` | `number` | 请求超时,默认 15000 |
| `maxRetries` | `number` | 429 退避重试次数,默认 2 |
| `userAgent` | `string` | 自定义 User-Agent |

### VrchatClient

| 成员 | 说明 |
| --- | --- |
| `isLoggedIn` | 当前是否持有会话 cookie |
| `login(options)` | 密码登录(2FA 通过 `onNeedCode` 交互);`options` 含 `username` / `password` / `store` / `onNeedCode` 等 |
| `logout()` | 登出并清除本地 cookie 与存储 |
| `auth` | 认证域:`currentUser()` / `checkSession()` / `logout()` / `getConfig()` / `getFavoriteLimits()` |
| `users` | 用户域:`getById()` / `getProfile()` / `getByUsername()` / `search()` / `getFriendStatus()` / `getUserWorlds()` / `getGroups()` / `getMutuals()` / `getAvatar()` / `listActive()` / `updateCurrent()` / `listNotes()` / `createNote()` / `updateNote()` / `deleteNote()` |
| `worlds` | 世界域:`getById()` / `search()` / `listFavorites()` / `listRecent()` / `listActive()` / `getInstances()` / `getMetadata()` / `addTags()` / `removeTags()` / `publish()` / `update()` / `delete()` |
| `avatars` | 头像域:`getById()` / `search()` / `listOwned()` / `listFavorites()` / `listLicensed()` / `getStyles()` / `selectCurrent()` / `selectFallback()` |
| `instances` | 实例域:`getById()` / `getByShortName()` / `getShortName()` / `create()` / `listRecent()` |
| `friends` | 好友域:`list()` / `sendRequest()` / `delete()` |
| `notifications` | 通知域:`list()` / `getById()` / `accept()` / `hide()` / `markSeen()` / `reply()` / `clear()` |
| `favorites` | 收藏域:`list()` / `add()` / `remove()` / `getByGroup()` / `listGroups()` / `createGroup()` / `deleteGroup()` |
| `groups` | 群组域:`getById()` / `search()` / `create()` / `update()` / `delete()` / `listMembers()` / `getMember()` / `removeMember()` / `addRoleToMember()` / `removeRoleFromMember()` / `listRoles()` / `listRoleTemplates()` / `listInstances()` / `listPermissions()` / `createRole()` / `deleteRole()` / `listRequests()` / `approveRequest()` / `listBans()` / `banMember()` / `unbanMember()` / `join()` / `leave()` / `getAnnouncement()` / `setAnnouncement()` |
| `files` | 文件域:`getById()` / `list()` / `create()` / `createImage()` / `delete()` / `startUpload()` / `finishUpload()` / `getUploadStatus()` |
| `permissions` | 权限域:`list()` / `getById()` |
| `system` | 系统域:`health()`(需登录)/ `stats()`(在线人数,无需登录)/ `time()`(无需登录) |
| `economy` | 经济域:`getBalance()` / `getTransactions()` |
| `moderation` | 审核域:`list()` / `create()` / `unmoderate()` / `report()` |
| `invite` | 邀请域:`invite()` / `requestInvite()` / `joinSelf()` / `respond()` |
| `messages` | 快捷消息域:`list()` / `get()` / `update()` |
| `close()` | 关闭传输层 |

## 错误处理

统一 `VrchatError`,错误消息与日志脱敏(不输出 cookie、用户名密码):

| 错误码 | 场景 |
| --- | --- |
| `LOGIN_REQUIRED` | 未登录 |
| `AUTH_EXPIRED` | 会话失效(401) |
| `INVALID_CREDENTIALS` | 用户名或密码错误 |
| `TWO_FACTOR_REQUIRED` / `TWO_FACTOR_FAILED` | 2FA 相关 |
| `NOT_FOUND` | 404(资源不存在) |
| `FORBIDDEN` | 403(权限不足) |
| `RATE_LIMIT` | 429 限流(带 `retryAfterSeconds`) |
| `NETWORK` / `TIMEOUT` | 网络失败 / 超时 |
| `UNKNOWN` | 其他 |

登录流程(经 account 骨架)抛 `AccountError`,API 调用抛 `VrchatError`,SDK 不自动转换,上层需分别处理。

## CLI

```powershell
amechan-vrchat login [username]                  # 密码登录(2FA 交互输入)
amechan-vrchat status                            # 查看登录状态
amechan-vrchat logout                            # 登出
amechan-vrchat users get|profile|search|friend-status|worlds|groups|mutuals|avatar|active|update-status|update-bio
amechan-vrchat worlds get|search|favorites|recent|active|add-tags|remove-tags|publish
amechan-vrchat avatars get|search|owned|favorites|licensed|styles|select
amechan-vrchat instances get <worldId> <instanceId>|recent
amechan-vrchat friends list|add|remove
amechan-vrchat notifications list|get|accept|hide|see|reply|clear
amechan-vrchat favorites list|add|remove|groups|by-group
amechan-vrchat groups get|search|members|member|remove-member|add-role|remove-role|roles|role-templates|instances|permissions|requests|approve|bans|ban|unban|join|leave|announcement|announce
amechan-vrchat files get|list|create|create-image|delete
amechan-vrchat permissions list|get
amechan-vrchat system health|stats|time
amechan-vrchat economy balance|transactions
amechan-vrchat moderation list|create|delete|report
amechan-vrchat invite invite|request|join|respond
amechan-vrchat messages list|get|update
```

测试/自定义网关可用环境变量 `AMECHAN_VRCHAT_BASE_URL` / `AMECHAN_VRCHAT_AUTH_PATH` 覆盖默认配置。完整用法见 [`skills/vrchat-cli/SKILL.md`](../../skills/vrchat-cli/SKILL.md)。

## 在仓库内的验证方式

```powershell
pnpm --filter @sakurachiyo0v0/vrchat typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/vrchat test        # 单测(本地 mock VRChat API,真实 HTTP 协议路径)
pnpm --filter @sakurachiyo0v0/vrchat build       # 构建 ESM + CJS + d.ts + CLI
```

## 合规

- 只操作自己账号的数据;
- 不绕过限流、不批量刷操作;
- 不保存密码,凭证仅 cookie 并脱敏。

## 设计文档

[`docs/superpowers/specs/2026-08-23-vrchat-sdk-design.md`](../../docs/superpowers/specs/2026-08-23-vrchat-sdk-design.md)
