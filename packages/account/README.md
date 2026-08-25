# @sakurachiyo0v0/account

跨平台账号认证底座:登录态存储、扫码登录骨架、密码登录骨架与公共错误模型。**不感知具体平台**——网易云、B 站、酷狗、QQ 音乐等平台的登录方式差异收敛在各自的适配器实现里,登录流程、存储、CLI 全复用。

## 安装

```powershell
pnpm add @sakurachiyo0v0/account@workspace:*
# 或
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/account"
```

## 快速开始(以网易云为例,适配器在 `@sakurachiyo0v0/netease-music` 内)

```ts
import { AuthStore, qrcodeLogin } from "@sakurachiyo0v0/account";
import { neteaseQrAdapter } from "@sakurachiyo0v0/netease-music";

// 1. 弹窗扫码(系统浏览器打开本地页面,手机 App 扫码确认)
const store = new AuthStore({ platform: "netease-music" });
const { credentials, saved } = await qrcodeLogin({
  adapter: neteaseQrAdapter(),
  store, // 登录成功自动持久化到 <配置根>/amechan/netease-music/auth.json
});

// 2. 之后读取登录态
const payload = await store.load();
```

## API

### `AuthStore`

跨平台登录态存储(路径按平台命名空间隔离,原子写 + 600 权限):

| 方法 | 说明 |
| --- | --- |
| `new AuthStore({ platform, path? })` | `path` 缺省为 `<配置根>/amechan/<platform>/auth.json` |
| `save(payload)` | 原子写入(临时文件 + rename),chmod 600 |
| `load()` / `loadSync()` | 读取;不存在/损坏返回 `null` |
| `clear()` | 删除,不存在时静默 |
| `exists()` | 文件是否存在 |
| `platform` / `path` | 平台名 / 文件路径 |

### `qrcodeLogin(options)` → `Promise<LoginResult>`

| 选项 | 说明 | 默认 |
| --- | --- | --- |
| `adapter` | 平台适配器(必填,见下) | — |
| `store` | 登录态存储;登录成功自动持久化 | 不持久化 |
| `autoOpenBrowser` | 是否自动打开浏览器 | `true` |
| `timeoutMs` | 总超时 | `180_000`(3 分钟) |
| `pollIntervalMs` | 轮询间隔 | `2000` |
| `maxRegenerates` | 二维码过期后最大重生成次数 | `3` |
| `openBrowser` | 自定义浏览器打开器 | 平台默认 |
| `onQrCode` | 二维码图片回调 `(dataUrl: string) => void`(每次生成/重生成触发,供远程/聊天渠道展示给用户扫码) | — |
| `fetchImpl` | 注入 fetch(测试用) | 全局 fetch |
| `onStatus` | 进度回调 `{ state, message }` | — |

状态机:`waiting → scanned → success`,二维码失效自动重生成,超时抛 `AccountError("LOGIN_REQUIRED")`。返回 `{ credentials, saved }`。

### `QrLoginAdapter`(平台适配器契约)

```ts
interface QrLoginAdapter {
  platform: string;                     // 决定 AuthStore 默认路径
  generateKey(fetchImpl): Promise<{ key: string; url: string }>;
  pollStatus(key, fetchImpl): Promise<{
    state: "waiting" | "scanned" | "success" | "expired";
    message: string;
    credentials?: PlatformCredentials;  // success 时必填
  }>;
  refresh?(credentials, fetchImpl): Promise<PlatformCredentials>;  // 可选续期
  serialize(credentials, savedAt): AuthPayload;
  deserialize(payload): PlatformCredentials | null;
}
```

新平台接入 = 实现这 5 个方法(扫码登录平台)或仅 `serialize`/`deserialize`(直接注入凭证的平台),登录窗口、轮询、存储、错误模型全部复用。

### `passwordLogin(options)` → `Promise<LoginResult>`

密码登录骨架(与 `qrcodeLogin` 平行),支持 2FA 交互:

| 选项 | 说明 | 默认 |
| --- | --- | --- |
| `adapter` | 平台适配器(必填,见下) | — |
| `username` / `password` | 用户名与密码(必填) | — |
| `onNeedCode` | 需要 2FA 时取验证码的回调 `({ method, message, attempt }) => string` | 无(缺省抛 `TWO_FACTOR_REQUIRED`) |
| `store` | 登录态存储;登录成功自动持久化 | 不持久化 |
| `maxCodeAttempts` | 2FA 验证码最大重试次数 | `3` |
| `fetchImpl` | 注入 fetch(测试用) | 全局 fetch |
| `onStatus` | 进度回调 `{ state, message }`(`submitting` / `need_code` / `success` / `failed`) | — |

流程:`adapter.login(username, password)` → 若 `need_code` 循环取码验证 → 成功可选落盘。验证码超过 `maxCodeAttempts` 或取码为空抛 `AccountError("TWO_FACTOR_FAILED")`。

### `PasswordLoginAdapter`(密码登录平台适配器契约)

```ts
interface PasswordLoginAdapter {
  platform: string;                     // 决定 AuthStore 默认路径
  login(
    { username, password },
    fetchImpl,
  ): Promise<
    | { status: "success"; credentials: PlatformCredentials }
    | { status: "need_code"; challengeId: string; method: string; message: string }
  >;
  verifyCode(
    { challengeId, method },
    code,
    fetchImpl,
  ): Promise<PasswordLoginStep>;       // 成功或新的 need_code(重试)
  refresh?(credentials, fetchImpl): Promise<PlatformCredentials>;  // 可选续期
  serialize(credentials, savedAt): AuthPayload;
  deserialize(payload): PlatformCredentials | null;
}
```

新密码登录平台接入 = 实现这 5 个方法(VRChat 即如此,见 `@sakurachiyo0v0/vrchat`),2FA 交互、重试上限、存储、错误模型全部复用。

### `browserLogin(options)` → `Promise<LoginResult>`

浏览器登录骨架(与 `qrcodeLogin` / `passwordLogin` 平行),适用于**无公开登录 API、只能靠网页浏览器会话**的平台(如 BOOTH):

| 选项 | 说明 | 默认 |
| --- | --- | --- |
| `adapter` | 平台适配器(必填,见下) | — |
| `store` | 登录态存储;登录成功自动持久化 | 不持久化 |
| `browserPath` | Chrome/Edge 可执行文件路径 | 自动检测本机 |
| `reuseBrowserProfile` | 复用日常浏览器 profile 的登录态(免重新输账号密码;需先关闭该浏览器) | `false`(临时隔离 profile) |
| `profileDir` | 显式指定 profile 目录(覆盖推断;不会被删除) | — |
| `useCdp` | 是否 CDP 自动浏览器登录;`false` 走捕获页(无头/测试环境) | `true` |
| `loginUrl` | 登录页 URL(覆盖 `adapter.loginUrl`) | adapter 值 |
| `timeoutMs` | 等待用户登录的总超时 | `300000`(5 分钟) |
| `openBrowser` / `onLog` / `fetchImpl` / `onStatus` | 浏览器打开器(捕获页)/日志回调/注入 fetch/进度回调 | — |

流程:CDP 弹出独立 Chrome 窗口 → 用户登录 → 轮询 `Storage.getCookies` 捕获会话 cookie(含 HttpOnly) → 平台校验 → 可选落盘;无可用浏览器时回退"捕获页"(用户从 F12 复制 Cookie 头粘贴回传,仅走本机回环)。CDP 只在本机回环通信,凭证不经过任何第三方。返回 `{ credentials: { cookieHeader }, saved }`。

### `BrowserLoginAdapter`(浏览器登录平台适配器契约)

```ts
interface BrowserLoginAdapter {
  platform: string;                       // 决定 AuthStore 默认路径
  loginUrl: string;                       // 登录页 URL(在弹起的 Chrome 窗口中打开)
  cookieDomains: string[];                // 只收集这些域的 cookie(如 ["booth.pm"])
  sessionCookieNames: string[];           // 出现任一即视为登录成功的 cookie 名
  validate?(cookieHeader, fetchImpl): Promise<void>;  // 可选:登录后校验(抛错 = 会话无效)
  serialize(credentials, savedAt): AuthPayload;
  deserialize(payload): PlatformCredentials | null;
}
```

新"网页登录型"平台接入 = 实现这 6 项(BOOTH 即如此,见 `@sakurachiyo0v0/booth` 的 `boothBrowserAdapter`),CDP 捕获、捕获页回退、校验、存储、错误模型全部复用。配套导出 `detectBrowser()` / `defaultBrowserProfileDir()`(定位本机 Chrome/Edge 及其日常 profile)。

### 其它

- `resolveConfigRoot()` / `defaultAuthPath(platform)` — 配置目录解析(Windows `%APPDATA%` / macOS `~/Library/Application Support` / Linux `$XDG_CONFIG_HOME`,支持 `AMECHAN_CONFIG_HOME` 覆盖)
- `AccountError` — 错误码 `NETWORK` / `API_ERROR` / `AUTH_EXPIRED` / `LOGIN_REQUIRED` / `UNKNOWN` / `INVALID_CREDENTIALS` / `TWO_FACTOR_REQUIRED` / `TWO_FACTOR_FAILED`,消息不泄露凭据

## 验证

```powershell
pnpm --filter @sakurachiyo0v0/account typecheck && test && build
```
