# @sakurachiyo0v0/bilibili-auth

B 站扫码登录模块:本地窗口展示二维码 → 手机 App 扫码 → 自动收集 cookie 与 refresh_token → 持久化 + 自动续期。与视频解析/下载解耦,可独立使用。

## 安装

```powershell
pnpm add @sakurachiyo0v0/bilibili-auth@workspace:*
# 或
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/bilibili-auth"
```

## 快速开始

```ts
import { qrcodeLogin, AuthStore } from "@sakurachiyo0v0/bilibili-auth";

// 1. 弹窗扫码(系统浏览器打开本地页面,手机 App 扫码确认)
const { cookies, refreshToken } = await qrcodeLogin();

// 2. 持久化到平台用户配置目录(权限 600)
const store = new AuthStore();
await store.save({ cookies, refreshToken, savedAt: new Date().toISOString() });

// 3. 之后读取 / 续期
const data = await store.load();
if (data) {
  const renewed = await refreshCookies(data); // refresh_token 换新 cookie
  await store.save(renewed);
}
```

## API

### `qrcodeLogin(options?)` → `Promise<LoginResult>`

| 选项 | 说明 | 默认 |
| --- | --- | --- |
| `autoOpenBrowser` | 是否自动打开浏览器 | `true` |
| `timeoutMs` | 总超时 | `180_000`(3 分钟) |
| `pollIntervalMs` | 轮询间隔 | `2000` |
| `maxRegenerates` | 二维码过期后最大重生成次数 | `3` |
| `openBrowser` | 自定义浏览器打开器 | 平台默认 |
| `fetchImpl` | 注入 fetch(测试用) | 全局 fetch |
| `onStatus` | 进度回调 `{ state, message }` | — |

状态机:`waiting → scanned → success`,二维码失效自动重生成,超时抛 `BilibiliAuthError("LOGIN_REQUIRED")`。返回 `{ cookies, refreshToken }`(cookies 含 `SESSDATA` / `bili_jct` / `DedeUserID` 等)。

无头环境:传 `autoOpenBrowser: false`,从 `onStatus` 拿到扫码链接手动打开,或自行接入终端二维码。

### `AuthStore`

| 方法 | 说明 |
| --- | --- |
| `save(data)` | 原子写入(临时文件 + rename),chmod 600 |
| `load()` / `loadSync()` | 读取;不存在/损坏返回 `null` |
| `clear()` | 删除,不存在时静默 |
| `exists()` | 文件是否存在 |
| `path` | auth.json 完整路径 |

默认路径(可用 `--auth-path` / `BILI_AUTH_PATH` / `AMECHAN_CONFIG_HOME` 覆盖):

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\amechan\bilibili\auth.json` |
| macOS | `~/Library/Application Support/amechan/bilibili/auth.json` |
| Linux | `$XDG_CONFIG_HOME/amechan/bilibili/auth.json` |

### `refreshCookies(data, fetchImpl?)` → `Promise<AuthData>`

用 `refresh_token` 换新 cookie 并合并覆盖,返回 `expiresAt = now + 90d`。refresh_token 失效抛 `BilibiliAuthError("AUTH_EXPIRED")`。

### `parseCookieString(cookie)` → `Record<string, string>`

cookie 字符串解析为对象。

## 错误码(`BilibiliAuthError.code`)

`NETWORK` / `API_ERROR` / `AUTH_EXPIRED` / `LOGIN_REQUIRED` / `UNKNOWN`

## 与 @sakurachiyo0v0/bilibili 的关系

`createBilibiliClient({ authPath })` 未传 cookie 时自动用 `AuthStore` 加载登录态;API 返回 -101 时自动 `refreshCookies` 续期并重试一次。CLI 命令 `amechan-bilibili login|status|logout` 也由本包支撑。

## 验证

```powershell
pnpm --filter @sakurachiyo0v0/bilibili-auth typecheck && test && build
```
