# `@sakurachiyo0v0/bilibili` 扫码登录模块设计

状态:用户已批准
日期:2026-08-13

## 1. 当前问题与目标

`@sakurachiyo0v0/bilibili` 当前只支持手动传入 cookie(`createBilibiliClient({ cookie })`、CLI `--cookie` / `BILI_COOKIE` 环境变量),没有任何登录流程:

- 没有登录入口,用户必须先手动从浏览器复制 cookie;
- cookie 不落盘、不管理,过期(约 1-3 个月)后要重新手动复制;
- 匿名请求容易被 B 站风控(实测本环境出口返回 -412/-400/404),登录态 cookie 是稳定解法;
- 高画质(1080P+)必须登录。

本次目标:为 `@sakurachiyo0v0/bilibili` 增加完整的扫码登录模块。

- 弹出窗口(本地 HTTP 页面 + 系统默认浏览器)展示二维码,用户用手机 B 站 App 扫码;
- 自动收集登录 Set-Cookie(SESSDATA / bili_jct / DedeUserID)与 refresh_token;
- cookie 持久化到平台标准用户配置目录(文件权限 600),支持自定义路径;
- CLI 新增 `login` / `logout` / `status` 命令;SDK 未显式传 cookie 时自动从存储加载;
- cookie 失效时用 refresh_token 自动续期,无需重新扫码。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 手动复制浏览器 cookie | `amechan-bilibili login` 扫码即得 |
| cookie 散落在命令行/环境变量 | 登录一次,CLI 与 SDK 自动复用 |
| cookie 过期后重新复制 | refresh_token 自动续期,无感 |
| 匿名请求被风控拦截 | 登录态 cookie 稳定通过 |
| 无登录状态可查 | `amechan-bilibili status` / `logout` |

## 3. 方案选择

### 3.1 登录方式:扫码登录(采用)

B 站没有 OAuth/Device Code;浏览器登录后 cookie 受同源策略保护,外部进程拿不到。唯一可靠的无密码方式是我们自己生成二维码、自己轮询确认:

1. `POST passport.bilibili.com/x/passport-login/web/qrcode/generate` → `{ qrcode_key, url }`;
2. 轮询 `GET passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=...`:
   - `code=0` 成功,响应 Set-Cookie 含 SESSDATA/bili_jct/DedeUserID,body 含 refresh_token;
   - `code=-2` 未扫码、`-4` 已扫未确认、`-5` 二维码过期(重新生成);
3. 成功后把 cookie 与 refresh_token 落盘。

不做手机号/账号密码登录(扫码是网页标准,够用)。

### 3.2 窗口形态:本地 HTTP 页面 + 系统浏览器(采用)

| 方案 | 结论 |
| --- | --- |
| 本地 HTTP server + `start`/`open`/`xdg-open` 打开系统浏览器 | **采用**:零重型依赖、跨平台、贴近"弹窗"体验 |
| 终端 ANSI 二维码 | 不用:不算窗口 |
| Electron 桌面窗口 | 不用:约 200MB 依赖,个人 SDK 过重 |

二维码渲染依赖 `qrcode`(纯 JS、无原生依赖)。页面轮询本地 server 的 `/poll`,由 server 转发 B 站 poll 接口(浏览器直连 B 站存在 CORS 问题)。

安全:本地 server 只监听 `127.0.0.1`,使用随机端口 + 一次性 CSRF token(嵌入 URL 与页面),防止本机其他进程误触发。

### 3.3 Cookie 存储:用户配置目录 + 600 权限(采用)

- 路径:平台标准用户配置目录下 `amechan/bilibili/auth.json`:
  - Windows:`%APPDATA%\amechan\bilibili\auth.json`
  - macOS:`~/Library/Application Support/amechan/bilibili/auth.json`
  - Linux:`$XDG_CONFIG_HOME/amechan/bilibili/auth.json`(缺省 `~/.config`)
- 支持 `--auth-path` / `AUTH_PATH` 覆盖;
- 文件权限 600(Windows 下尽力而为);
- 内容明文(`cookies` / `refreshToken` / `buvid3` / `savedAt` / `expiresAt?`),仅存会话凭证;日志与错误信息不打印 cookie 本体;
- 不做系统级加密(DPAPI/Keychain 跨平台成本高,个人工具过度设计)。

### 3.4 过期处理:refresh_token 自动续期(采用)

- 登录时一并保存 refresh_token;
- `POST passport.bilibili.com/x/passport-login/web/cookie/refresh`(带 refresh_token)→ 新 cookie + 新 refresh_token,更新 store;
- refresh_token 也失效 → 抛 `AUTH_EXPIRED`,提示重新 `login`。

## 4. 架构与数据流

新增 `packages/bilibili/src/auth/`:

```
src/auth/
├─ store.ts      AuthStore:路径解析、load/save/clear/exists、600 权限
├─ login.ts      扫码登录:generate → 本地 server → 打开浏览器 → 轮询 → 收集 → 落盘
├─ refresh.ts    续期:cookie/refresh 换新 cookie
└─ index.ts      导出
```

### 数据流

**login 命令:**

```
CLI login
 → AuthStore.resolvePath()(--auth-path 或平台默认)
 → POST qrcode/generate → { qrcode_key, url }
 → 起本地 server(127.0.0.1:随机端口,/poll + 一次性 token)
 → 打开系统浏览器(页面渲染二维码,JS 轮询 /poll)
 → 页面轮询 → server 转发 qrcode/poll
 → code=0:收集 Set-Cookie + refresh_token → AuthStore.save() → 关闭 server → 输出成功
 → 超时(默认 3 分钟)或 -5:提示并退出;清理 server
```

**SDK 使用:**

```
createBilibiliClient({ cookie? , authPath? })
 → 显式 cookie 优先;否则 AuthStore.load()
 → ApiSession 带 cookie 请求
 → 遇到登录态失效(API code -101)且 store 存在
   → refresh() 一次 → 更新 store → 重试该请求
```

**CLI download/streams:** 未传 `--cookie` 时自动从存储加载。

## 5. 接口设计

### 5.1 AuthStore

```ts
interface AuthData {
  cookies: string;          // "SESSDATA=...; bili_jct=...; DedeUserID=..."
  refreshToken: string;
  buvid3?: string;
  savedAt: string;          // ISO
  expiresAt?: string;       // 可选:refresh 后的 cookie 过期时间
}

class AuthStore {
  constructor(path?: string);            // 默认平台用户配置目录
  readonly path: string;
  load(): AuthData | null;              // 不存在/损坏 → null(损坏时告警)
  save(data: AuthData): Promise<void>;  // 原子写 + 600 权限
  clear(): Promise<void>;
  exists(): boolean;
}
```

### 5.2 登录流程

```ts
interface LoginResult { cookies: string; refreshToken: string; }
async function qrcodeLogin(options: {
  store: AuthStore;
  pollIntervalMs?: number;   // 默认 2000
  timeoutMs?: number;        // 默认 180_000
  openBrowser?: (url: string) => Promise<void> | void;  // 可注入,便于测试
}): Promise<LoginResult>;
```

### 5.3 续期

```ts
async function refreshCookies(data: AuthData): Promise<AuthData>;  // 抛 BilibiliError(AUTH_EXPIRED | NETWORK)
```

### 5.4 SDK 集成

```ts
createBilibiliClient(options: {
  cookie?: string;          // 显式优先
  authPath?: string;        // 未传 cookie 时从该存储加载
  download?, merge?, ...
});
```

### 5.5 CLI

```
amechan-bilibili login    [--auth-path <path>] [--no-browser]   # 弹出窗口扫码登录
amechan-bilibili logout   [--auth-path <path>]                  # 删除存储的登录态
amechan-bilibili status   [--auth-path <path>]                  # 显示是否已登录/过期时间(不打印 cookie)
```

`--no-browser`:只打印二维码 URL,不自动打开浏览器(无头环境)。

## 6. 错误处理与安全

- 新增 `BilibiliError` 错误码 `AUTH_EXPIRED`;复用 `LOGIN_REQUIRED` / `NETWORK` / `API_ERROR`;
- cookie 内容不进入日志与错误信息;`status` 只显示"已登录/未登录/已过期"与过期时间;
- auth.json 写盘用临时文件 + rename 原子发布;读取容错(JSON 损坏 → 视为未登录并告警);
- 本地 server 仅监听回环地址,随机端口,一次性 token;
- 轮询失败(网络抖动)指数退避,不无限重试;超时或二维码过期给出明确提示。

## 7. 测试

- mock passport 接口(复用现有 `baseUrl` 覆盖模式),不依赖真实网络;
- store:路径解析(各平台)、读写往返、权限、损坏文件容错、clear;
- login:generate/poll 状态机(-2 → -4 → 0、-5 重新生成、超时)、Set-Cookie 收集、本地 server 生命周期(启动/关闭/仅回环)、`--no-browser` 路径;
- refresh:成功续期、refresh_token 失效抛 `AUTH_EXPIRED`;
- CLI:login/logout/status 命令的输入输出(注入假 server / 假 store);
- SDK:未传 cookie 自动加载、显式 cookie 优先、-101 触发自动刷新重试。

## 8. 明确不做(YAGNI)

- 手机号+验证码登录、账号密码登录;
- 多账号管理;
- cookie 系统级加密;
- 登录状态的 GUI 管理界面(CLI 足够)。

## 9. 依赖

- `qrcode`(纯 JS 二维码生成,零原生依赖)新增为 `@sakurachiyo0v0/bilibili` 的运行时依赖;
- 不新增其它运行时依赖;`qrcode` 的类型包按需 `@types/qrcode`(devDependency)。
