# account 浏览器登录骨架 browserLogin 设计

状态:用户已批准方案 A(2026-08-24)
日期:2026-08-24

## 1. 当前问题与目标

- 现状:BOOTH 无公开登录 API,登录态只能靠网页浏览器会话。`@sakurachiyo0v0/booth` 自研了一套 CDP(Chrome DevTools Protocol)浏览器自动化登录(`src/cdp.ts`):启动独立 Chrome/复用日常 profile、轮询 `Storage.getCookies` 抓 HttpOnly cookie、捕获页回退、登录后校验。该实现本身已高度通用(CDP 客户端零依赖、浏览器检测、profile 复用全参数化),但**平台耦合点(登录页、cookie 域、会话特征、校验逻辑)与 CDP 核心混在一个包里**,其它"网页登录型"平台无法复用,只能复制粘贴。
- 目标:把 booth 的 CDP 登录抽象为 account 的**第三个登录骨架** `browserLogin()` + `BrowserLoginAdapter` 契约,与 `qrcodeLogin` / `passwordLogin` 平行;booth 改为只实现契约,删除自研 `cdp.ts`。后续"网页登录型"平台接入 = 实现契约 6 项,CDP 捕获、捕获页回退、校验、存储、错误模型全部复用。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 只有 booth 能浏览器登录;新平台要复制 `cdp.ts` + 捕获页 + 校验胶水,改 4 处硬编码 | 任何平台实现 `BrowserLoginAdapter` 6 项即获得完整浏览器登录(CDP → 捕获页回退 → 校验 → 落盘) |
| booth 的 CDP 核心与 BOOTH 平台细节耦合在 `cdp.ts` / `client.ts` | booth 只剩 `login-adapter.ts`(纯契约实现);公共 API(`loginBooth` / 错误类型 / 浏览器工具函数)不变 |
| `openBrowserDefault` / `detectBrowser` / `defaultBrowserProfileDir` 在 booth 与 account 重复 | 统一收敛到 account;booth re-export 保持公共 API |

## 3. 方案选择

### 方案 A:抽进 account,做成第三个契约 `browserLogin()` + `BrowserLoginAdapter`(采用)

- 优点:与仓库现有架构完全一致(`QrLoginAdapter` / `PasswordLoginAdapter` 之后第三个契约);booth 改造后作为模板的验证用例;`--reuse 日常浏览器 profile` 免输密码能力所有平台白捡;零新增依赖(CDP 纯手写,`node:child_process` / `node:http` account 已在用)。
- 缺点:account 包体增加 ~600 行;浏览器登录与扫码/密码登录关注点略有不同,但本质都是"登录"。(可接受)

### 方案 B:抽成独立包 `@sakurachiyo0v0/browser-login`(不采用)

- 优点:浏览器自动化可独立演进。
- 缺点:增加包管理成本;与 account 登录底座定位重叠,`AuthStore` / `AccountError` 仍需跨包依赖。

### 方案 C:只抽纯函数,不进契约(不采用)

- 优点:改动最小。
- 缺点:每个平台仍要自己写校验 + 落盘胶水,复用度低,违背"新平台接入 = 实现契约"的现有约定。

### 方案 D:不动代码,booth 当文档化参考模板(不采用)

- 优点:零风险。
- 缺点:复制粘贴造成重复实现,无法演进。

## 4. 仓库结构

```text
packages/account/src/
├─ browser-flow.ts    浏览器登录骨架(BrowserLoginAdapter 契约 + browserLogin + CDP/捕获页/detectBrowser)
├─ qr-flow.ts         扫码登录骨架(不变,提供 openBrowserDefault 复用)
├─ password-flow.ts   密码登录骨架(不变)
├─ store.ts / paths.ts / errors.ts / types.ts(不变)
└─ index.ts           导出 browserLogin / detectBrowser / defaultBrowserProfileDir 等

packages/booth/src/
├─ login-adapter.ts   BoothBrowserAdapter(纯契约实现;serialize 格式兼容旧 auth.json)
├─ client.ts          loginBooth 转调 account.browserLogin,错误映射回 BoothError
├─ index.ts           浏览器工具函数改为从 account re-export
└─ cdp.ts             已删除
```

## 5. 接口设计

### BrowserLoginAdapter(平台适配器契约)

```ts
interface BrowserLoginAdapter {
  platform: string;                       // 决定 AuthStore 默认路径
  loginUrl: string;                       // 登录页 URL(在弹起的 Chrome 窗口中打开)
  cookieDomains: string[];                // 只收集这些域的 cookie(如 ["booth.pm"])
  sessionCookieNames: string[];           // 出现任一即视为登录成功的 cookie 名
  validate?(cookieHeader: string, fetchImpl: typeof fetch): Promise<void>;
                                          // 可选:登录后校验(抛 AccountError = 会话无效)
  serialize(credentials: PlatformCredentials, savedAt: string): AuthPayload;
  deserialize(payload: AuthPayload): PlatformCredentials | null;
}
```

### browserLogin(options)

| 选项 | 说明 | 默认 |
| --- | --- | --- |
| `adapter` | 平台适配器(必填) | — |
| `store` | 登录态存储;登录成功自动持久化 | 不持久化 |
| `browserPath` | 浏览器可执行文件路径 | 自动检测本机 Chrome/Edge |
| `reuseBrowserProfile` | 复用日常浏览器 profile 登录态(免输账号密码;需先关闭该浏览器) | `false`(临时隔离 profile) |
| `profileDir` | 显式指定 profile 目录(不会被删除) | — |
| `useCdp` | 是否 CDP 自动浏览器登录;`false` 走捕获页(无头/测试) | `true` |
| `loginUrl` / `timeoutMs` / `openBrowser` / `onLog` / `fetchImpl` / `onStatus` | 覆盖/注入项 | — |

流程:CDP 弹独立 Chrome 窗口 → 用户登录 → 轮询 `Storage.getCookies`(按 `cookieDomains` 过滤、`sessionCookieNames` 判成功)捕获 cookie 头 → `adapter.validate` 校验 → `serialize` + 可选落盘。无可用浏览器时回退捕获页(本地回环 HTTP,用户从 F12 粘贴 Cookie 头回传)。返回 `{ credentials: { cookieHeader }, saved }`。

## 6. 错误处理

| 错误码 | 含义 | 上层提示 |
| --- | --- | --- |
| `UNKNOWN` | 浏览器不存在 / CDP 启动失败 / 调试端口不可用 | 检查浏览器安装 |
| `AUTH_EXPIRED` | 登录超时未完成 / 复用 profile 时浏览器在运行 / validate 校验失败 | 重试登录或先关闭浏览器 |
| `LOGIN_REQUIRED` | 捕获页登录超时 | 重新执行 login |
| `NETWORK` | 网络类失败 | 检查网络 |

全部收敛为 `AccountError`(validate 抛普通错误时经 `toAccountError` 归类);booth 的 `loginBooth` 包装层再映射回 `BoothError` 保持公共 API 不变。

## 7. 测试策略

- account `tests/browser-flow.test.ts`:捕获页回退走真实本地回环(与 booth login.test 同款):回传 cookie 后落盘 / 不传 store 不落盘 / validate 失败抛错且不落盘 / 浏览器路径不存在报错。CDP 完整路径不启动真实浏览器,只测前置失败。
- booth `tests/login.test.ts` 保持通过(捕获页回传路径,行为不变),证明模板化无回归。
- 捕获页超时用可取消定时器,避免 race settle 后残留 promise 触发 unhandled rejection。

## 8. CLI 与 skill 同步

- 无 CLI 变更:booth 的 `amechan-booth login` 公共签名与语义不变;account 无 CLI。
- 不涉及 skill 更新。

## 9. 版本与发布

- account `0.2.0 → 0.3.0`(新特性:浏览器登录骨架)。
- booth `0.1.0 → 0.2.0`(内部实现迁移,公共 API 不变;删除 `cdpLogin` 导出属内部清理)。
- 待用户确认后提交推送,CI 发布,`pnpm verify:published` 消费验证。

## 10. 验收条件

- [x] `browserLogin` + `BrowserLoginAdapter` 可用:account 4 个测试 + booth 92 个测试全绿(含登录捕获页路径行为不变)
- [x] booth 删除 `cdp.ts`,公共 API(`loginBooth` / `BoothError` / 浏览器工具函数)不变
- [x] 文档更新:account README + docs/packages-index.md
- [ ] 版本 bump 完成(account 0.3.0 / booth 0.2.0),`pnpm check` 全绿
- [ ] 用户确认后提交推送,CI 发布成功,消费验证通过
