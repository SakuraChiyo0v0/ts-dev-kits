# @sakurachiyo0v0/booth

BOOTH(booth.pm,Pixiv 旗下数字商品市场)SDK:登录态管理、商品解析、免费领取 / 付费加购、文件下载与批量编排。

**适用环境:** Node.js 20+,运行在可信任的服务端进程;不要在浏览器/WebView 中保存会话 cookie。

> BOOTH 没有官方公开 API。本 SDK 基于页面协议模拟(商品页 JSON-LD / downloadables 直链 / 加购表单),端点集中在 `src/api/endpoints.ts` 常量化,站点改版时可能报 `API_ERROR`,需按真实抓包更新。

## 领取机制(2026-08 真实抓包校准)

- **免费商品(0 日元)**:页面含 `<a class="btn add-cart" href="/downloadables/<id>?variation_id=<vid>">`。SDK 请求该链接 → BOOTH 302 重定向到 S3 预签名直链 → 直接流式下载,**不生成订单**。
- **付费商品**:页面含 `<form action="https://<shop>.booth.pm/cart?added_to_cart=true">`(字段 `cart_item[variation_id]` + `authenticity_token`)。SDK POST 加购;若被 Cloudflare 人机验证拦截(403),自动降级为返回购物车 URL,支付永远在浏览器手动完成。
- **已拥有**:页面按钮态为「購入済み」等,claim 返回 `skipped`。

## 安装

同一 pnpm workspace 内:

```powershell
pnpm add @sakurachiyo0v0/booth@workspace:*
```

从私有 GitHub monorepo 安装(需在消费项目 `pnpm-workspace.yaml` 中授权 `@sakurachiyo0v0/booth` 与 `@sakurachiyo0v0/account` 构建脚本):

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/booth"
```

## 快速开始

```ts
import { createBoothClient } from "@sakurachiyo0v0/booth";

const client = createBoothClient(); // 登录态自动从 AuthStore 加载

// 解析商品
const item = await client.getItem("https://booth.pm/ja/items/12345");
console.log(item.title, item.priceYen === 0 ? "免费" : `${item.priceYen}円`);

// 领取:免费 → claimed(downloadUrl + 可选下载);付费 → paid-pending(payUrl)
const results = await client.claim(["https://booth.pm/ja/items/12345"]);
console.log(results[0]);

// 一条龙:领取后直接下载(仅免费商品)
const done = await client.claimAndDownload("https://booth.pm/ja/items/12345", {
  outputDir: "./downloads",
});
console.log(done.files);
```

## 登录

两种方式,凭证统一存到 `<配置根>/amechan/booth/auth.json`(复用 `@sakurachiyo0v0/account` 的 AuthStore):

```ts
import { loginBooth, createBoothClient } from "@sakurachiyo0v0/booth";

// 1. 自动浏览器登录:检测本机 Chrome/Edge,CDP 弹独立窗口捕获会话(零复制粘贴,HttpOnly cookie 也可提取)
await loginBooth();

// 2. 手动:已有 cookie 头字符串
const client = createBoothClient({ cookie: "_pixiv_session=..." });
await client.persistLogin();
```

CLI 方式:`amechan-booth login` / `login --manual` / `status` / `logout`。

## API

### `createBoothClient(options?)`

| 选项 | 说明 |
| --- | --- |
| `cookie` | 显式会话 cookie(优先于 AuthStore) |
| `authPath` | AuthStore 自定义路径(缺省平台默认) |
| `baseUrl` | 覆盖站点基地址(测试/自定义网关) |
| `fetchImpl` | 注入 fetch(测试) |
| `download.retries` | 单文件重试次数,默认 2 |
| `download.rateLimitBps` | 限速(字节/秒),默认不限 |
| `download.skipExisting` | 已存在文件跳过,默认 true |
| `claim.concurrency` | 批量领取并发,默认 1 |

### 方法

| 方法 | 说明 |
| --- | --- |
| `getItem(input)` | 解析链接或纯 ID → `BoothItem`(标题/价格/店铺/是否已拥有/downloadUrl/variationId) |
| `getItemDetail(input, opts?)` | 解析商品详情:简介/正文(`description`)+ 全部购买项(`variations`);`opts.description/variations` 可按需关闭省 token |
| `claim(inputs, opts?)` | 批量领取:免费 claimed(downloadUrl)/ 付费 paid-pending(payUrl)/ 已拥有 skipped / 失败带错误码;保持输入顺序,单项失败不中断 |
| `claimByInput(input)` | 单个领取 |
| `downloadUrl(url, opts?)` | 按下载直链下载到 `outputDir`(claim 结果的 downloadUrl) |
| `claimAndDownload(input, opts?)` | 领取后下载一条龙(付费待支付不下载) |
| `persistLogin(authPath?)` / `clearLogin(authPath?)` | 登录态写入/清除 |

### 输入格式

`booth.pm/<lang>/items/<id>`(ja / en / zh-cn / zh-tw 等任意语言前缀)或纯数字 ID。

## 错误码

| 错误码 | 含义 |
| --- | --- |
| `NETWORK` | 网络层失败(连接/超时/DNS) |
| `API_ERROR` | 端点返回非预期响应(页面结构变化,需更新 SDK) |
| `NOT_FOUND` | 商品不存在/已下架/链接无效 |
| `INVALID_URL` | 输入无法解析为 booth 链接或纯 ID |
| `LOGIN_REQUIRED` | 未登录或登录态缺失 |
| `AUTH_EXPIRED` | 会话过期/失效 |
| `ALREADY_OWNED` | 已拥有(claim 中为 skipped) |
| `PAYMENT_REQUIRED` | 付费待支付(claim 中为 paid-pending) |
| `DOWNLOAD_FAILED` | 文件下载失败 |

错误消息一律脱敏:不打印完整 cookie、不泄露签名 URL 参数。

## CLI

```bash
amechan-booth login [--manual] [--auth-path <path>]
amechan-booth status
amechan-booth logout
amechan-booth parse <链接|ID> [--detail] [--no-description] [--no-variations]
amechan-booth claim <链接|ID>... [--output-dir <dir>] [--concurrency <n>] [--no-download]
amechan-booth download <download-url> [--output-dir <dir>]
```

环境变量:`AMECHAN_BOOTH_BASE_URL`(测试/网关)、`AMECHAN_BOOTH_AUTH_PATH`(登录态路径)。

## 合规边界

- 只操作自己的账号,领取/下载自己拥有的商品;不绕过支付、不伪装会员、不代抢。
- 免费商品直接下载;付费商品仅加购物车(遇 Cloudflare 拦截自动降级为购物车 URL),**支付永远在浏览器手动完成**,SDK 不执行任何支付操作。
- 批量领取默认并发 1(可配置),避免对站方造成压力;不鼓励囤积转售。

## 在仓库内的验证方式

```powershell
pnpm --filter @sakurachiyo0v0/booth typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/booth test        # 单测(本地 mock BOOTH 服务器,真实协议路径)
pnpm --filter @sakurachiyo0v0/booth build       # 构建 ESM + CJS + d.ts + CLI
```

设计文档:`docs/superpowers/specs/2026-08-23-booth-sdk-design.md`;实现计划:`docs/superpowers/plans/2026-08-23-booth-sdk.md`。
