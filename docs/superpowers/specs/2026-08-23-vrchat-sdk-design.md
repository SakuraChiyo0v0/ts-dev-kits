# `@sakurachiyo0v0/vrchat` VRChat 官方 API SDK 设计

状态:用户已批准
日期:2026-08-23

## 1. 当前问题与目标

仓库内目前没有任何 VRChat 相关能力。任何项目要对接 VRChat 官方 API(`https://api.vrchat.cloud/api/1`)都必须从零处理:用户名密码认证 + 2FA(邮箱 OTP / TOTP)、认证 cookie 的会话管理与持久化、强制 User-Agent、速率限制(429 + `X-RateLimit-*` 响应头)、错误归类等一整套繁琐且有坑的机制。

本次目标是在 `ts-dev-kits` monorepo 中创建 `@sakurachiyo0v0/vrchat`:

- 封装 VRChat 官方 REST API 的**全功能域**:认证 / 用户 / 世界 / 头像 / 实例 / 好友 / 通知 / 收藏 / 群组 / 文件 / 权限;
- 提供统一、类型安全、可测试的调用接口,能力分阶段交付,每阶段独立可用;
- 同步为 `@sakurachiyo0v0/account` 增加**通用密码登录骨架**(`PasswordLoginAdapter` + `passwordLogin()`),与既有扫码骨架(`QrLoginAdapter` + `qrcodeLogin`)平行,未来任何密码登录平台可复用;
- 提供 CLI(`sc-vrchat`)与 skill,走仓库完整开发流程。

**运行形态(硬约束)**:VRChat API 是远程 HTTPS API,消费方是运行在用户机器或服务器上的 Node 20+ 进程。认证凭证只保存 cookie,**不保存密码**。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 对接 VRChat API 要自己处理认证/2FA/cookie/限流/UA | 一行 `createVrchatClient()` + `vrchatQrAdapter` 等价物(密码适配器)完成登录,能力按领域模块调用 |
| account 只有扫码登录骨架,密码登录平台无法复用 | account 0.2.0 新增通用密码登录骨架,任何平台实现 5 个方法即接入 |
| 错误结构、限流策略不一致,凭证易被日志泄露 | SDK 统一 `VrchatError` + 错误码,消息脱敏,凭证只存 cookie 不存密码 |
| 没有独立验证方式 | 通过本地 mock VRChat API 服务器做真实协议路径测试 |

## 3. 方案选择

### 方案 A:`account` 加平行契约 `PasswordLoginAdapter` + `passwordLogin()`(采用)

与 `QrLoginAdapter`/`qrcodeLogin` 完全对称:适配器契约(平台实现)+ 通用骨架(状态机/交互/落盘)+ `AccountError`。VRChat 实现 `PasswordLoginAdapter`:`login(username, password)` → 若需 2FA 返回「待验证」状态 → `verifyCode(code)` → 凭证 = cookie 字符串。2FA 交互通过 `onNeedCode` 回调(CLI 从 stdin 读 / 程序注入函数取码),不锁死交互方式。

- 优点:复用 `AuthStore` 落盘/校验;骨架可被未来任何密码登录平台复用;改动集中、向后兼容(仅新增 API,不动扫码路径)。
- 缺点:account 需要一次 minor 版本迭代(0.1.0 → 0.2.0)。

### 方案 B:直接在 vrchat 包内实现登录,不动 account(不采用)

违背用户明确要求「加一个通用的密码登录骨架」,登录逻辑无法复用,pass。

### 方案 C:把扫码/密码统一成一套抽象登录骨架(不采用)

改动现有 `qrcodeLogin` 契约,影响已发布的 bilibili / netease-music 消费方,风险大收益小,pass。

### 与 Booth 开发的冲突规避(重要约束)

仓库内另有 Booth SDK 开发(`docs/superpowers/specs/2026-08-23-booth-sdk-design.md`,用户已批准)。经核实其设计:Booth 登录为**浏览器捕获 cookie**(本地回环临时 HTTP + `--manual` 粘贴),仅使用 account 的现有 `AuthStore`(平台 `"booth"`),**不修改 account 包骨架**;其新增包 `packages/booth/` 与 vrchat 新增包完全独立。

即便如此,本 SDK 的 account 改动仍遵循**只新增、不修改**原则,为任何未来合入留足余地:

- 密码登录骨架全部定义在**新文件** `packages/account/src/password-flow.ts`(含 `PasswordLoginAdapter` / `PasswordLoginStep` / `PasswordLoginOptions`),不写入 `types.ts`;
- `errors.ts` 新错误码**追加到联合类型末尾**,不修改现有行;
- `index.ts` 在**文件末尾追加**导出行,不动现有导出;
- account 版本 bump 与 Booth 合入统一协调到最终版本号再发布,避免重复发布。

## 4. 仓库结构

```text
ts-dev-kits/
├─ packages/
│  ├─ account/                  # 改动:新增密码登录骨架(不破坏扫码路径,只新增不修改)
│  │  ├─ src/
│  │  │  ├─ password-flow.ts    新增:PasswordLoginAdapter / PasswordLoginStep / PasswordLoginOptions + passwordLogin() 骨架
│  │  │  ├─ errors.ts           追加错误码 INVALID_CREDENTIALS / TWO_FACTOR_REQUIRED / TWO_FACTOR_FAILED(末尾追加)
│  │  │  └─ index.ts            末尾追加导出 passwordLogin 及类型
│  │  └─ tests/password-login.test.ts
│  └─ vrchat/
│     ├─ src/
│     │  ├─ index.ts             公共出口:只导出稳定 API
│     │  ├─ client.ts            VrchatClient 门面 + createVrchatClient()
│     │  ├─ transport.ts         传输层:base URL / cookie / UA / 限流 / 重试
│     │  ├─ errors.ts            VrchatError + 错误码
│     │  ├─ types.ts             API 数据模型(用户/世界/头像/实例/...)
│     │  ├─ auth-adapter.ts      VrchatPasswordAdapter(实现 account 契约)
│     │  └─ endpoints/
│     │     ├─ auth.ts           认证域:currentUser / logout / checkSession / getConfig
│     │     ├─ users.ts          用户域
│     │     ├─ worlds.ts         世界域
│     │     ├─ avatars.ts        头像域
│     │     ├─ instances.ts      实例域
│     │     ├─ friends.ts        好友域
│     │     ├─ notifications.ts  通知域
│     │     ├─ favorites.ts      收藏域
│     │     ├─ groups.ts         群组域
│     │     ├─ files.ts          文件域
│     │     └─ permissions.ts    权限域
│     │  └─ cli/
│     │     ├─ index.ts          sc-vrchat 入口
│     │     ├─ login.ts          login / logout / status
│     │     └─ ...               各域命令(按阶段逐个加)
│     ├─ tests/
│     │  ├─ helpers/mock-vrchat-server.ts  本地 mock VRChat API
│     │  └─ *.test.ts
│     ├─ scripts/clean.mjs
│     ├─ package.json
│     ├─ tsconfig.json / tsconfig.build.json / tsconfig.bundle.json
│     ├─ rollup.config.mjs
│     └─ README.md
├─ skills/vrchat-cli/SKILL.md    # 与 CLI 命令集同步
```

遵循仓库 `docs/package-template.md` 的全部约定:`UNLICENSED`、ESM+CJS+`.d.ts`、`files` 只发 `dist` + README、`sideEffects: false`、`engines.node >=20`、vitest 测试。

## 5. 接口设计

### 5.1 account 密码登录骨架(全部定义于 `password-flow.ts`,不写入 `types.ts`)

```ts
// ---- types.ts(新增) ----

/** 平台凭证(登录成功后由平台适配器产出)。 */
export type PlatformCredentials = Record<string, unknown>;

export type PasswordLoginStep =
  | { status: "success"; credentials: PlatformCredentials }
  | { status: "need_code"; challengeId: string; method: string; message: string };

export interface PasswordLoginAdapter {
  /** 平台名,如 "vrchat",决定 AuthStore 默认路径。 */
  readonly platform: string;
  /** 提交用户名密码;返回下一步(成功或需要 2FA 验证)。 */
  login(
    credentials: { username: string; password: string },
    fetchImpl: typeof fetch,
  ): Promise<PasswordLoginStep>;
  /** 提交 2FA 验证码;成功返回凭证。method 为 "otp" | "totp" 时 IDE 有字面量提示。 */
  verifyCode(
    step: { challengeId: string; method: "otp" | "totp" | (string & {}) },
    code: string,
    fetchImpl: typeof fetch,
  ): Promise<PasswordLoginStep>;
  /** 可选:登录态续期;无续期机制的平台省略。 */
  refresh?(credentials: PlatformCredentials, fetchImpl: typeof fetch): Promise<PlatformCredentials>;
  /** 凭证序列化/反序列化(与 QrLoginAdapter 相同)。 */
  serialize(credentials: PlatformCredentials, savedAt: string): AuthPayload;
  deserialize(payload: AuthPayload): PlatformCredentials | null;
}

export interface PasswordLoginOptions {
  adapter: PasswordLoginAdapter;
  /** 必填:用户名与密码。CLI 的交互式输入发生在调用骨架之前(读 stdin 后再传),骨架本身不负责取用户名密码。 */
  username: string;
  password: string;
  /** 需要 2FA 时取验证码的回调(CLI 从 stdin 读 / 程序注入)。 */
  onNeedCode?: (info: { method: string; message: string; attempt: number }) => Promise<string> | string;
  /** 登录态存储;不传则不持久化。 */
  store?: AuthStore;
  /** 最大验证码重试次数,默认 3。 */
  maxCodeAttempts?: number;
  /** 注入 fetch 实现(测试用)。 */
  fetchImpl?: typeof fetch;
  /** 进度回调。 */
  onStatus?: (status: { state: string; message: string }) => void;
}
```

流程:`adapter.login(username, password)` → 若 `need_code`,循环 `onNeedCode()` 取码 → `adapter.verifyCode(...)` → 成功则 `store.save(adapter.serialize(...))`。2FA 错误超过 `maxCodeAttempts` 抛 `AccountError("TWO_FACTOR_FAILED", ...)`。

### 5.2 vrchat 客户端门面

```ts
import { createVrchatClient } from "@sakurachiyo0v0/vrchat";

const client = await createVrchatClient({ authPath?: string, ... });
// 未登录时抛 LOGIN_REQUIRED;或传入 autoLogin 选项

client.auth          // currentUser / logout / checkSession / getConfig
client.users         // getById / search / update / ...
client.worlds        // getById / search / ...
client.avatars       // getById / search / selectCurrent / ...
client.instances     // getById / create / ...
client.friends       // list / sendRequest / delete / ...
client.notifications // list / accept / decline / clear
client.favorites     // list / add / remove / groups
client.groups        // getById / search / members / ...
client.files         // upload chain
client.permissions   // list

await client.close();
```

### 5.3 数据模型约定

端点返回的 raw VRChat JSON **保持原样透传**(与 lol 包同策略),TypeScript 类型只做描述不做强制清洗;可选的高层解析后续阶段按需添加,默认不污染底层 API。

## 6. 认证协议(VRChat API 事实)

1. `GET /auth/user` — Basic Auth(凭证 URL 编码后 base64:`encodeURIComponent(user):encodeURIComponent(pass)`)→ 成功返回用户对象 + `Set-Cookie: auth=...`。**注意:官方登录是 GET 而非 POST(`POST /auth/user` 返回 405,2026-08-23 实测 + 对照 VRCX 实现确认)**
2. 若账号开了 2FA,响应带 `requiresTwoFactorAuth: ["emailOtp" | "totp"]`,此时**未真正登录**
3. `POST /auth/twofactorauth/emailotp/verify`(邮箱验证码)或 `/auth/twofactorauth/totp/verify`(TOTP)→ `{ code }` → 成功后拿到最终 cookie
4. `GET /auth/user` — 检查会话有效性(会话失效会 401)
5. `PUT /logout` — 登出
6. API 有速率限制,响应头带 `X-RateLimit-*`,超限 429

参考:[VRChat 官方 API 文档](https://vrchatapi.github.io/)、[VRCX 会话管理文档](https://deepwiki.com/vrcx-team/VRCX/4.6-authentication-and-session-management)、[vrchatapi-csharp AuthenticationApi](https://github.com/UdonVR/vrchatapi-csharp/blob/66b6fbe87b6cf56c558ec11a4f9b28db36d393ba/docs/AuthenticationApi.md)。

## 7. 关键机制

### 7.1 传输层(transport)

- Base URL `https://api.vrchat.cloud/api/1`,强制 `User-Agent`(VRChat API 要求,缺失会被拒);
- cookie 自动携带(`auth=...`),登录成功后由 auth 域注入;
- **限流处理**:读 `X-RateLimit-Remaining` / `Retry-After`,429 时自动退避重试(可配置最大次数);内置对登录接口的节流(VRChat 对登录失败有较严的锁定策略);
- 401 → 抛 `AUTH_EXPIRED`(会话失效,调用方可触发重新登录);
- 404 / 403 / 429 → 对应 `NOT_FOUND` / `FORBIDDEN` / `RATE_LIMIT`;
- 重试:幂等 GET 默认重试(指数退避),写操作不自动重试(防副作用重复)。

### 7.2 认证凭证

- 凭证 = `{ authCookie: string }`,**只存 cookie,不存密码**;
- 经 `AuthStore` 落盘(`<配置根>/amechan/vrchat/auth.json`,600 权限);
- 会话失效(401)→ `AUTH_EXPIRED`,调用方可 `passwordLogin()` 重新登录。

## 8. 错误处理

### 8.1 account 新增错误码

| 错误码 | 含义 | 上层提示 |
| --- | --- | --- |
| `INVALID_CREDENTIALS` | 用户名或密码错误 | 请检查用户名密码 |
| `TWO_FACTOR_REQUIRED` | 需要 2FA 但未提供取码途径 | 提供 onNeedCode 回调或交互式输入 |
| `TWO_FACTOR_FAILED` | 2FA 验证码错误/超限 | 请重新获取验证码 |

### 8.2 vrchat 统一 `VrchatError`

登录流程(通过 account 骨架)抛 `AccountError`,API 调用抛 `VrchatError` —— **SDK 不自动转换错误类型**,保持各自原始类型;上层(CLI / 调用方)需同时捕获两者,登录相关错误按 `AccountError` 处理,其余按 `VrchatError` 处理。CLI 层统一展示与退出码映射。

| 错误码 | 场景 |
| --- | --- |
| `LOGIN_REQUIRED` | 未登录 |
| `AUTH_EXPIRED` | 会话失效(401) |
| `INVALID_CREDENTIALS` | 登录时用户名或密码错误 |
| `TWO_FACTOR_REQUIRED` / `TWO_FACTOR_FAILED` | 2FA 相关 |
| `NOT_FOUND` | 404(用户/世界/头像不存在) |
| `FORBIDDEN` | 403(权限不足) |
| `RATE_LIMIT` | 429 限流 |
| `NETWORK` | 网络失败 |
| `TIMEOUT` | 请求超时 |
| `UNKNOWN` | 其他 |

错误消息与日志**脱敏**(不输出 cookie、用户名密码)。

## 9. 测试策略(真实协议路径优先)

- **mock-vrchat-server**(`tests/helpers/`):用 Node 原生 `http` 起本地假 VRChat API——暴露 `/auth/user`(Basic Auth + 2FA 分支)、`/auth/twofactorauth/*/verify`、各域查询端点,带 `Set-Cookie` 与 `X-RateLimit-*` 头。测试通过真实 HTTP 协议调用,验证:认证头、cookie 注入、JSON 编解码、错误归类、限流退避、会话失效处理。
- **account 骨架测试**:fake adapter 状态机(与 `qr-flow.test.ts` 同款),覆盖成功/2FA 重试/超限/落盘。
- **真实账号集成测试**:`it.skipIf` 标注,仅在设置了 `VRCHAT_E2E=1` 时运行(不纳入 CI),由用户手动验证登录与 2FA。
- 写操作自清理(测试结束恢复现场)。

## 10. CLI 与 skill 同步

- CLI 命令集(`sc-vrchat`):`login [username]` / `logout` / `status` 起步,各域查询命令按阶段逐个加;
- **改了 CLI 命令(新增/改名/删除/参数/语义)必须同步 `skills/vrchat-cli/SKILL.md`**,否则 pre-commit 的 `scripts/check-skill-staleness.mjs` 会阻止提交。

## 11. 能力清单与阶段划分

| 阶段 | 内容 | 关键端点 | 风险 |
| --- | --- | --- | --- |
| **P0 底座** | account 0.2.0 密码登录骨架 + vrchat 包骨架(transport/errors/types/auth 域/auth-adapter/CLI login/logout/status) | `/auth/user`、`/auth/twofactorauth/*/verify`、`/logout`、`/config` | 无 |
| **P1 核心只读** | users / worlds / avatars / instances / friends / notifications 六域查询 + CLI 查询命令 | `/users/*`、`/worlds/*`、`/avatars/*`、`/instances/*`、`/auth/user/friends`、`/auth/user/notifications` | 无 |
| **P2 核心写操作** | 好友请求/删除、通知接受/拒绝/清除、收藏增删/分组、头像选择、个人信息更新 | `/user/{id}/friendRequest`、`/auth/user/notifications/{id}/accept`、`/favorites`、`/avatars/{id}/select`、`PUT /users/{id}` | 低 |
| **P3 进阶** | 群组、文件上传链路、世界发布/更新/删除、权限查询 | `/groups/*`、`/file/*`、`/worlds/{id}/publish`、`/permissions` | 低(发布类操作需披露) |
| **P4 收尾** | 全 API 对照检查(逐端点核对官方 OpenAPI)、skill 同步、`pnpm check`、版本 bump、文档更新、可选 dsh-sdk-tools 集成 | — | 无 |

**v0.1.0 首发 = P0 + P1**。P2 之后的阶段按需求与反馈推进,每个阶段独立可用、独立可发布。

### P4 全 API 对照审计(2026-08-23 实测)

对照官方 OpenAPI 规范(`vrchatapi/specification` 仓库 `openapi/components/paths.yaml`,470 条路径引用)逐端点核对:

| 官方域 | SDK 覆盖 |
| --- | --- |
| Authentication | `auth`(登录/2FA/会话/登出/config) |
| Users | `users`(get/profile/name/search/friendStatus/worlds/groups/mutuals/avatar/active/update/notes) |
| Worlds | `worlds`(get/search/favorites/recent/active/metadata/addTags/removeTags/publish/update/delete/instances) |
| Avatars | `avatars`(get/search/favorites/licensed/styles/owned/select/selectFallback) |
| Instances | `instances`(get/shortName/create/recent) |
| Friends | `friends`(list/sendRequest/delete/boop 未做) |
| Notifications | `notifications`(list/accept/hide/clear/see/respond 部分) |
| Favorites | `favorites`(list/add/remove/byGroup/groups) |
| Groups | `groups`(查询/创建/成员详情/移除成员/角色分配与移除/角色/角色模板/群组实例/群组权限/加入申请批准/封禁管理/加入/离开/公告;posts/galleries/auditLogs/transfer 未做) |
| Files | `files`(get/list/create/createImage/delete/upload start/finish/status 完整链路) |
| Permissions | `permissions`(list/get) |
| System | `system`(health 需登录/visits 在线人数/time;infoPush 未做) |
| Economy | `economy`(balance/transactions;purchases/licenses 未做) |
| Moderation | `moderation`(playermoderations list/create/delete;report) |
| Invite | `invite`(invite/requestInvite/joinSelf/respond)+ `messages`(快捷消息 list/get/update) |
| 未覆盖 | Admin、Calendar、Inventory、Jams、Prints、Props、Subscription 管理、licenseGroups、creator store 等内部/管理域(普通用户账号不可用或合规不涉及) |

审计修正(对照官方规范纠错):`system.stats` 路径 `/stats`→`/visits`;`economy.getTransactions` 路径 `/user/{id}/transactions`→`/user/{id}/economy/transactions`;`moderation.report` 路径 `/auth/user/report`→`/moderationReports`;`users.updateCurrent` 路径 `/users/me`→`PUT /users/{id}`;`files.list` 路径 `/file`→`GET /files`;2FA 验证路径 `otp`→`emailOtp`(`POST /auth/twofactorauth/emailotp/verify`,官方无 `/otp/verify`);`users.getFriendStatus` 路径 `/users/{id}/friendStatus`→`/user/{id}/friendStatus`(官方单数 user)。**登录协议(2026-08-23 实测修正)**:官方登录 = `GET /auth/user` + Basic(凭证 URL 编码后 base64),`POST /auth/user` 真实返回 405;已对照 VRCX(第三方客户端)实现确认,`auth-adapter.login` 与 mock 同步修正。**2FA cookie 链路(2026-08-23 实测修正)**:第一步 `GET /auth/user` 即 `Set-Cookie: auth=authcookie_<uuid>`(最终会话 cookie,有效期约 1 年);verify 成功响应只 `Set-Cookie: twoFactorAuth=<JWT>`(**2FA 票据,不能作会话凭证**);最终会话 cookie = 第一步的 `auth=...`。`#extractAuthCookie` 正则修正为精确匹配 `auth=`(避免误匹配 `twoFactorAuth=` 中的 `auth=`),`verifyCode` 验证成功后保留第一步 cookie 作为最终凭证,mock 同步真实行为并回归(测试断言 2FA 后 cookie = 第一步 authcookie)。**avatars 搜索 marketplace(2026-08-23 实测修正)**:文本搜索必须带 `marketplace`(paid|free|all),否则真实 API 400 "Text search queries must specify a marketplace"(官方 spec 未含此参数,滞后);`avatars.search` 文本搜索自动附带 `marketplace=all`(可显式指定)。**moderation 域(2026-08-23 对照官方 playermoderation.yaml 修正)**:官方无按 id 删除路径,删除单条 = `PUT /auth/user/unplayermoderate`(body `{moderated, type}`),create 字段为 `moderated`(非 targetUserId);`moderation.delete`→`unmoderate` 同步 CLI/skill/mock/测试。**instances 补齐**:新增 `getShortName`(`GET /instances/{worldId}:{instanceId}/shortName`,官方 instances.yaml + VRCX 均有)。所有修正已同步 mock server 与测试。

真实 API 冒烟(2026-08-23,只读系统端点实测):`GET /time` 返回 ISO 字符串、`GET /visits` 返回纯数字(在线人数)、`GET /health` 需登录(未登录 401);据此已将 `system.health` 移至需登录区、`system.stats` 类型改为 `number`、`system.time` 类型改为 `string`,mock 与测试同步对齐真实行为。

### 合规红线(贯穿所有阶段)

- 只操作自己账号的数据;
- 不绕过限流、不批量刷操作(与 bilibili 包「刷量重灾区写操作不提供」一致);
- 不保存密码,凭证仅 cookie 并脱敏。

## 12. 版本与发布

- `@sakurachiyo0v0/account`:0.1.0 → **0.2.0**(新增公开 API);
- `@sakurachiyo0v0/vrchat`:**0.1.0** 起步,按阶段 minor/patch 递增;
- CI 自动发布(依赖顺序 account → vrchat);发布后跑 `pnpm verify:published <包名>` 消费验证。

## 13. 验收条件

- [x] P0 底座完成:account 密码登录骨架测试全绿;vrchat 登录/登出/会话恢复可用(mock + 真实账号冒烟)
- [x] P1 核心只读:六域查询 API + CLI 命令可用,单测覆盖错误分支
- [x] P2 核心写操作:好友/通知/收藏/头像选择/个人信息更新 + CLI 命令可用
- [x] P3 进阶:群组/文件/世界发布/权限 + CLI 命令可用
- [x] P4 收尾:system/economy/moderation 补充域 + invite 域 + 文件上传完整链路 + 通知 markSeen + 全 API 对照 + 真实 API 冒烟(2026-08-23:time/visits/health/config/avatarStyles/worlds 行为实测对齐)+ skill 同步 + 版本 bump + dsh-sdk-tools 集成(vrchat_whoami / vrchat_user / vrchat_worlds_search,默认关)
- [x] 每阶段 `pnpm --filter <受影响包> typecheck && test` 通过;全仓 `pnpm check` 通过(2026-08-23 实测 exit 0,含 vrchat 71 用例 + account 20 用例 + booth 84 用例全绿;booth 并行线后续活跃开发引入类型错误/回归,非我方改动,vrchat/account 仍全绿)
- [x] CLI 冒烟测试:`tests/cli.test.ts` 覆盖子命令真实执行链路(users get / friends list / worlds search / notifications accept+see / groups member / files create-image / messages list / system time / 未知命令,共 11 用例)
- [x] 文档更新(README + packages-index + account README)
- [x] skill 已同步(涉及 CLI 改动时)
- [ ] 用户确认后提交推送,CI 发布成功,消费验证通过(待用户试用满意后确认)
