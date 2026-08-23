# B 站登录链路迁移到 account 通用底座

状态:用户已批准方案 A
日期:2026-08-23

## 1. 背景与目标

仓库存在两套平行登录体系:

- `@sakurachiyo0v0/account`(通用底座):`AuthStore({platform, path?})`、`QrLoginAdapter`(含 `refresh?` 钩子)、通用 `qrcodeLogin`(本地窗口 + 轮询 + 自动落盘)。netease-music 已接入。
- `@sakurachiyo0v0/bilibili-auth`(B 站专属):B 站 `qrcodeLogin`、`AuthStore(path?)`、`refreshCookies`、`parseCookieString`、`BilibiliAuthError`。
- `@sakurachiyo0v0/bilibili` 的 client / CLI / network 均 import bilibili-auth。

本设计(用户已批准,方案 A):**删除独立 `bilibili-auth` 包,B 站登录适配器(`QrLoginAdapter`)放到 bilibili 包内,登录链路完全复用 account 底座。** 这是 netease-music 设计文档 §11 预告的演进("bilibili-auth 后续逐步迁移到 account 底座,API 对外不变")。

## 2. 兼容性关键点(已实测确认)

1. **默认路径一致**:account `defaultAuthPath("bilibili")` = `<配置根>/amechan/bilibili/auth.json`,与 bilibili-auth 完全相同 → 现有登录态文件路径不变。
2. **格式差异需一次性迁移**:
   - 老格式(bilibili-auth):`{ cookies: string, refreshToken: string, savedAt: string, expiresAt?, buvid3? }`(凭证在顶层)
   - 新格式(account AuthPayload):`{ platform: "bilibili", credentials: { cookies, refreshToken, buvid3? }, savedAt, expiresAt? }`
   - account `AuthStore.loadSync()` 解析老格式会返回 null(platform 缺失) → client 构造时检测老格式并自动迁移为新格式写回,老用户登录态不丢。
3. **B 站扫码状态码映射**(迁入 adapter):
   - `86101` / `-2` → waiting(未扫码)
   - `-5` / `86038` / `86102` / `86103` → scanned(已扫待确认)
   - `-4` / `86090` → expired(二维码失效,重新生成)
   - `0` → success(响应 Set-Cookie 含 SESSDATA/bili_jct/DedeUserID,body data 含 refresh_token)
4. **续期**:account `QrLoginAdapter.refresh?` 钩子已预留,迁入 bilibili-auth `refreshCookies` 逻辑(POST `/x/passport-login/web/cookie/refresh`,body `{ csrf, refresh_token, source: "main_web" }`,合并新 Set-Cookie,失败抛 AUTH_EXPIRED)。

## 3. 变更清单

### 3.1 bilibili 包新增

**`src/auth/adapter.ts`** — `bilibiliQrAdapter(options?: { baseUrl?: string }): QrLoginAdapter`:

```ts
interface BilibiliCredentials {
  cookies: string;        // "SESSDATA=...; bili_jct=...; DedeUserID=..."
  refreshToken: string;
  buvid3?: string;
}

bilibiliQrAdapter({
  platform: "bilibili",
  generateKey(fetchImpl)      // GET passport /x/passport-login/web/qrcode/generate → { key: qrcode_key, url }
  pollStatus(key, fetchImpl)  // GET passport /x/passport-login/web/qrcode/poll?qrcode_key= → 状态映射 + success 收 Set-Cookie
  refresh(credentials, fetchImpl) // refresh_token 换新 cookie → BilibiliCredentials
  serialize(credentials, savedAt) // → AuthPayload(platform "bilibili")
  deserialize(payload)        // platform 校验 + credentials 提取;null 表示无效
});
```

**`src/auth/cookie.ts`** — `parseCookieString(cookie): Record<string, string>`(自 bilibili-auth 迁入,无改动)。

**`src/auth/index.ts`** — 导出 `bilibiliQrAdapter`、`parseCookieString`、类型 `BilibiliCredentials`。

### 3.2 bilibili 包修改

- **`src/client.ts`**:
  - import 改为 `@sakurachiyo0v0/account` 的 `AuthStore` + 本地 `bilibiliQrAdapter` / `parseCookieString`;
  - 构造:显式 cookie 优先;否则 `new AuthStore({ platform: "bilibili", ...(authPath ? { path: authPath } : {}) })` → `loadSync()` → 老格式检测迁移 → `adapter.deserialize(payload)` → cookie;
  - 续期:`onAuthFailure` 用 `adapter.refresh(credentials)` → `setCookie` + `store.save(adapter.serialize(refreshed, savedAt))`;
  - 内部凭证类型 `BilibiliCredentials` 替代原 `AuthData`。
- **`src/network.ts`**:`parseCookieString` 改为本地导入(`../auth/cookie.js`)。
- **`src/cli/bilibili.ts`**:
  - `login`:`qrcodeLogin({ adapter: bilibiliQrAdapter(), store: new AuthStore({ platform: "bilibili", path? }), autoOpenBrowser, timeoutMs, ... })` → 自动落盘,移除手动 save;
  - `logout` / `status`:改用 account `AuthStore({ platform: "bilibili" })`,`status` 从 `payload.credentials` 提取 savedAt/expiresAt。
- **`package.json`**:dependencies 移除 `@sakurachiyo0v0/bilibili-auth`,新增 `@sakurachiyo0v0/account`(workspace:*)。
- **`rollup.config.mjs`**:external 移除 `@sakurachiyo0v0/bilibili-auth` 与 `qrcode`(bilibili 源码不再直接依赖它们),保留 `@sakurachiyo0v0/account` 与 `@sakurachiyo0v0/ffmpeg` 为外部依赖。

### 3.3 删除

- 整个 `packages/bilibili-auth/` 目录(含 `src/*`、`tests/*`、`README.md`、`package.json` 等)。

### 3.4 测试

- **新 `tests/auth-adapter.test.ts`**:
  - generateKey:正常 / 响应缺 qrcode_key 抛错;
  - pollStatus 状态机:waiting(-2)→ scanned(-5)→ success(收 Set-Cookie + refresh_token);expired(-4)重新生成;
  - refresh:成功续期(新 Set-Cookie 合并)、refresh_token 失效抛 AUTH_EXPIRED、缺 bili_jct 抛 AUTH_EXPIRED;
  - serialize/deserialize 往返;platform 不匹配返回 null;**老格式 AuthPayload 兼容迁移**(顶层 cookies 字段 → 新 credentials)。
  - mock passport 接口(复用 bilibili-auth tests 的 redirectFetch 模式)。
- **改 `tests/client-auth.test.ts`**:`tempAuthFile` 写入新 AuthPayload 格式;新增"老格式 auth.json 自动迁移后登录可用"用例。
- **改 `tests/url.test.ts`**:`parseCookieString` 从 `../src/auth/cookie.js` 导入。
- 删除 bilibili-auth 的 3 个测试(auth-store / auth-refresh / auth-login)——store 逻辑由 account 测试覆盖,login 状态机由新 adapter 测试覆盖。

### 3.5 文档与脚本同步

- 根 `package.json` build 链:移除 `@sakurachiyo0v0/bilibili-auth build`;
- `AGENTS.md` 包清单:移除 bilibili-auth;
- `docs/packages-index.md`:移除 bilibili-auth 行与详情节;bilibili 详情改述"登录复用 account 底座";
- `docs/GITHUB_PACKAGES.md`、根 `README.md`:移除 bilibili-auth 引用;
- `scripts/publish-packages.mjs`:移除 bilibili-auth 条目,其余保持原相对顺序(`cli-utils → ffmpeg → email → account → lol → netease-music → bilibili → chat-platforms → dsh-sdk-tools`);
- `scripts/gen-repo-structure.mjs`:移除 bilibili-auth 条目;
- `pnpm-lock.yaml`:重新 `pnpm install` 生成;
- bilibili `README.md`:登录段落改述(登录实现内聚于 bilibili 包,复用 account);
- 更新 `2026-08-13-bilibili-login-design.md` 状态(已迁移);`2026-08-23-dsh-sdk-tools-design.md` 中 bilibili-auth 的"底座"描述同步更新为 account。

## 4. 错误与安全

- adapter 内协议错误统一抛 `BilibiliError`(复用 bilibili 包错误码 NETWORK / API_ERROR / AUTH_EXPIRED),不引入 BilibiliAuthError;
- cookie 不进入日志/错误信息;status 只显示已登录/未登录/过期时间;
- auth.json 写盘沿用 account AuthStore 原子写 + 600 权限;
- 老格式迁移仅在读取时做一次,写回新格式;迁移失败静默降级为未登录(不抛错)。

## 5. 明确不做(YAGNI)

- 多账号管理;
- cookie 系统级加密;
- 手机号/账号密码登录;
- 保留 bilibili-auth 兼容包(用户明确不再需要独立登录包)。

## 6. 验证清单

- [ ] `pnpm --filter @sakurachiyo0v0/account test` 通过(底座无改动,回归);
- [ ] `pnpm --filter @sakurachiyo0v0/bilibili typecheck && test` 通过(含新 adapter 测试 + client-auth 新格式);
- [ ] `pnpm check` 全仓通过;
- [ ] 真实扫码登录一次(生成/轮询/落盘/自动续期链路);
- [ ] 老格式 auth.json 迁移用例通过;
- [ ] `node scripts/publish-packages.mjs` 干跑:无 bilibili-auth 条目、依赖顺序正确;
- [ ] `docs/packages-index.md` / `AGENTS.md` / 根 README / GITHUB_PACKAGES.md 已同步。
