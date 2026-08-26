# @sakurachiyo0v0/booth BOOTH 领取/购买 SDK 设计

状态:用户已批准(2026-08-23)
日期:2026-08-23

## 1. 当前问题与目标

- 现状:BOOTH(booth.pm,Pixiv 旗下数字商品市场)没有官方公开 API。想自动领取 0 日元免费商品或对自己购买的商品做批量下载,只能靠浏览器手动操作。仓库已有 bilibili / netease-music 等平台 SDK,但没有覆盖 BOOTH。
- 目标:新增 `@sakurachiyo0v0/booth` SDK 包,登录(BOOTH/Pixiv 会话 cookie)后即可通过统一接口解析商品、领取/下单、查询订单、下载文件;提供 CLI 与 skill。本阶段范围:登录捕获 + 商品解析 + 下单(免费直接成交 / 付费生成待支付订单)+ 下载 + 批量编排。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 领取 BOOTH 免费商品要浏览器手动逐个购买 | 一条命令 `sc-booth claim <链接或ID>...` 批量领取,0 日元直接成交 |
| 已购买商品的下载文件要手动从订单页逐个下载 | SDK 按订单文件清单批量下载到本地,支持进度/重试/限速 |
| 登录态靠浏览器 cookie 手工管理 | `sc-booth login` 浏览器捕获会话并持久化到 AuthStore,`status` 校验 |
| 错误信息不统一、凭据易泄露 | 统一 `BoothError` + 错误码,消息脱敏 |

## 3. 方案选择

### 方案 A:自研 `@sakurachiyo0v0/booth` 包(采用)

- 优点:与仓库 bilibili / netease-music 同构;复用 `@sakurachiyo0v0/account` 的 AuthStore / 凭证序列化;mock 服务器测试覆盖真实协议路径;CLI + skill 联动符合仓库流程;长期可控可维护。
- 缺点:需要逆向 BOOTH 页面/端点(无官方 API),站点改版时需单点维护(端点集中管理缓解)。

### 方案 B:仓库 scripts 下放临时脚本(不采用)

- 优点:写得快。
- 缺点:无类型/测试/CLI/skill,不符合仓库「设计→实现→测试→文档→skill→发布→验证」一条龙流程,难维护。

### 方案 C:包装社区 npm 包(如 booth-pm-sdk)(不采用)

- 优点:省事。
- 缺点:社区包质量/维护性未知,接口随对方变,无法按仓库测试与安全约定把关,依赖不可控。

## 4. 仓库结构

```text
packages/booth/
├─ src/
│  ├─ index.ts            # 公共出口:值/类型分开导出,只暴露稳定 API
│  ├─ types.ts            # BoothItem / ClaimResult / DownloadFile / 配置类型(字段语义权威)
│  ├─ errors.ts           # BoothError + 错误码枚举 + 底层错误归类
│  ├─ session.ts          # 会话:显式 cookie 优先,否则从 AuthStore 加载;cookie 解析
│  ├─ api/
│  │  ├─ item.ts          # 商品页请求 + 内嵌 JSON/JSON-LD 解析(标题/价格/卖家/已拥有/CSRF)
│  │  ├─ order.ts         # 下单(免费/付费)+ 订单状态与支付状态查询
│  │  └─ download.ts      # 订单文件清单 + 文件下载(重试/进度/限速/幂等跳过)
│  ├─ parsers/
│  │  └─ url.ts           # booth.pm 链接 ↔ item id 解析;纯数字 ID 直接使用
│  ├─ client.ts           # BoothClient 统一入口 + 批量 claim 编排
│  └─ cli/
│     ├─ booth.ts         # sc-booth 入口(login|status|logout|claim|download)
│     └─ login-server.ts  # 本地回环临时 HTTP,接收浏览器注入的 cookie
├─ tests/
│  ├─ helpers/
│  │  └─ mock-server.ts   # 本地 mock BOOTH 服务(商品页/下单/文件清单/文件下载/用户页)
│  └─ *.test.ts           # URL 解析 / 商品解析 / 下单 / 下载 / 批量 / 错误归类 / 会话加载
├─ package.json
├─ tsconfig.json / tsconfig.build.json / tsconfig.bundle.json
├─ rollup.config.mjs
├─ README.md
└─ .gitignore            # 仓库根已覆盖,可不建
```

## 5. 接口设计

### 类型与枚举

```ts
/** 商品基础信息(从商品页解析)。 */
export interface BoothItem {
  id: string;              // 数字字符串商品 ID
  title: string;           // 商品标题
  priceYen: number;        // 价格(日元),0 表示免费
  shopId: string;          // 卖家店铺 ID
  shopName?: string;       // 卖家店铺名
  alreadyOwned: boolean;   // 当前登录账号是否已拥有
  csrfToken: string;       // 下单所需 CSRF token(页面提取)
}

/** 单个商品领取/下单结果。 */
export type ClaimStatus =
  | "claimed"          // 免费商品下单成功
  | "paid-pending"     // 付费商品,订单已生成待支付,需浏览器手动完成支付
  | "skipped";         // 已拥有(或登录态下无需再领),跳过,不算失败

export interface ClaimResult {
  input: string;            // 原始输入(链接或 ID)
  itemId: string;
  status: ClaimStatus | "failed";
  orderId?: string;         // 成交/待支付订单号
  payUrl?: string;          // paid-pending 时的支付 URL
  error?: { code: string; message: string };  // failed 时的错误信息(已脱敏)
}

/** 订单下载文件清单项。 */
export interface DownloadFile {
  orderId: string;
  fileName: string;        // 服务端文件名(含扩展名)
  sizeBytes?: number;
  url: string;             // 下载 URL(可能带签名)
}

/** 客户端配置。 */
export interface BoothClientOptions {
  cookie?: string;                  // 显式会话 cookie 头字符串(优先)
  authPath?: string;                // AuthStore 自定义路径(缺省用平台默认)
  baseUrl?: string;                 // 覆盖站点基地址(测试用 mock)
  fetchImpl?: typeof fetch;         // 注入 fetch(测试用)
  download?: {
    concurrency?: number;           // 文件并发,默认 3
    retries?: number;               // 单文件重试次数,默认 2
    rateLimitBps?: number;          // 限速(字节/秒),默认不限
    skipExisting?: boolean;         // 已存在同名文件跳过,默认 true
  };
  claim?: {
    concurrency?: number;           // 批量领取并发,默认 1(避免站方压力)
  };
}
```

### API 形状

```ts
/** 创建客户端。未传 cookie 时从 AuthStore({ platform: "booth" }) 自动加载。 */
export function createBoothClient(options?: BoothClientOptions): BoothClient;

export class BoothClient {
  /** 当前是否已登录(有会话 cookie)。 */
  readonly isLoggedIn: boolean;

  /** 解析输入:booth.pm 链接或纯数字 ID → 商品信息(不修改任何状态)。 */
  getItem(input: string): Promise<BoothItem>;

  /**
   * 批量领取/下单。输入可以是链接或纯 ID;保持输入顺序返回结果。
   * 免费商品直接成交;付费商品生成待支付订单并返回支付 URL(支付留在浏览器);
   * 已拥有跳过。任一失败不中断其余,失败项记入结果。
   */
  claim(inputs: string[], options?: { concurrency?: number }): Promise<ClaimResult[]>;

  /** 便捷:单个输入领取。 */
  claimByInput(input: string): Promise<ClaimResult>;

  /** 查询订单支付状态(付费商品在浏览器完成支付后 SDK 用来确认可下载)。 */
  isOrderPaid(orderId: string): Promise<boolean>;

  /** 获取订单下载文件清单。 */
  getOrderFiles(orderId: string): Promise<DownloadFile[]>;

  /** 下载单个订单的全部文件到 outputDir/<shop>-<item-id>/。 */
  downloadOrder(orderId: string, options?: { outputDir?: string }): Promise<string[]>;

  /** 一条龙:领取(或已拥有)后直接下载到本地。 */
  claimAndDownload(
    input: string,
    options?: { outputDir?: string; skipIfPaidPending?: boolean },
  ): Promise<{ claim: ClaimResult; files: string[] }>;
}

/** 浏览器登录捕获(CLI login 使用;也可编程调用)。 */
export function loginBooth(options?: {
  authPath?: string;
  openBrowser?: (url: string) => void | Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<{ account: string; saved: boolean }>;

export { BoothError };
```

## 6. 错误处理

| 错误码 | 含义 | 上层提示 |
| --- | --- | --- |
| `NETWORK` | 网络层失败(连接/超时/DNS) | 检查网络后重试 |
| `API_ERROR` | 端点返回非预期响应(页面结构变化) | 提示需更新 SDK / 稍后再试 |
| `NOT_FOUND` | 商品不存在/已下架/链接无效 | 检查商品链接 |
| `INVALID_URL` | 输入无法解析为 booth 链接或纯 ID | 检查输入格式 |
| `LOGIN_REQUIRED` | 未登录或登录态缺失 | 请先执行 login |
| `AUTH_EXPIRED` | 会话过期/失效 | 请重新 login |
| `ALREADY_OWNED` | 已拥有该商品(claim 中作为 skipped,不抛) | 无需重复领取 |
| `PAYMENT_REQUIRED` | 付费商品待支付(claim 中作为 paid-pending,不抛) | 请在浏览器完成支付 |
| `DOWNLOAD_FAILED` | 文件下载失败(重试后) | 检查网络/磁盘后重试 |
| `UNKNOWN` | 其他 | 查看日志 |

- 错误消息一律脱敏:不打印完整 cookie、不泄露签名 URL 中的敏感参数(仅提示前缀)。
- 底层 fetch/解析异常经 `toBoothError()` 归类为对应错误码。

## 7. 测试策略

- **mock 本地服务器(真实协议路径):** 测试进程内 `node:http` 起本地服务,模拟:
  - `GET /<lang>/items/<id>` — 返回含商品 JSON 的 HTML(价格 0/付费两种 fixture、已拥有标记、CSRF token);
  - `POST` 下单端点 — 按 body 返回成交订单 / 待支付订单 / 未登录 / 已拥有;
  - 订单文件清单与文件下载端点 — 返回真实字节流(大小校验);
  - 用户页校验端点 — 区分已登录/未登录(供 login 校验)。
- 客户端通过 `baseUrl` + `fetchImpl` 指向 mock,全链路不碰线上。
- 用例覆盖:URL/ID 解析(ja/en/zh-tw 等语言前缀、纯 ID、非法输入)、商品解析、免费下单、付费下单、已拥有跳过、批量并发与顺序保持、下载重试/进度/幂等跳过、错误码归类、会话加载优先级(显式 cookie > AuthStore)。
- **真实冒烟(手动,不进 CI):** 用户提供一次登录态后跑 `sc-booth claim <免费商品链接>` + `status` + `download` 验证真实链路。
- 写操作自清理:测试用 mock,不产生线上副作用;冒烟仅领取用户指定、明确同意的免费商品。

## 8. CLI 与 skill 同步

- 新增 CLI `sc-booth`,命令:

| 命令 | 说明 |
| --- | --- |
| `sc-booth login [--manual] [--auth-path <path>]` | 浏览器捕获登录(默认);`--manual` 引导粘贴 Cookie 头 |
| `sc-booth status` | 显示登录态(账号/有效性) |
| `sc-booth logout` | 清除本地登录态 |
| `sc-booth claim <input...> [--output-dir <dir>] [--concurrency <n>] [--no-download]` | 领取(免费直接成交;付费返回支付 URL);默认领取后下载(付费待支付不下载) |
| `sc-booth download <order-id> [--output-dir <dir>]` | 按订单号下载文件 |
| `sc-booth parse <input>` | 只解析商品信息,不领取 |

- 同步创建 `skills/booth-cli/SKILL.md`(命令/参数/用法/错误码表);否则 pre-commit 的 `scripts/check-skill-staleness.mjs` 会因命令集不一致阻止提交。

## 9. 版本与发布

- 初始版本 `0.1.0`(`UNLICENSED`,私有,不发布公共 registry)。
- 本阶段只落地源码/测试/文档,版本 bump 与发布按仓库流程在用户确认提交后处理;发布后跑 `pnpm verify:published @sakurachiyo0v0/booth`。

## 10. 验收条件

- [ ] `createBoothClient()` + `getItem` / `claim` / `downloadOrder` 最小示例跑通(mock 链路)
- [ ] 测试全绿:URL 解析 / 商品解析 / 免费+付费下单 / 已拥有跳过 / 批量顺序 / 下载重试与跳过 / 错误码归类 / 会话加载优先级
- [ ] CLI `sc-booth` 四命令可用,`skills/booth-cli/SKILL.md` 已同步
- [ ] README 与 `docs/packages-index.md` 已更新
- [ ] `pnpm check` 全仓通过
- [ ] 真实冒烟(用户配合登录)验证领取/下载一条龙
- [ ] 用户确认后提交推送(用 GitHub 身份,AGENTS.md 约定),CI 发布成功,消费验证通过

## 附:BOOTH 逆向要点(实现参考,非承诺)

- BOOTH 无官方公开 API;登录走 Pixiv 账号体系,会话以 cookie(如 `_pixiv_session`)维持。
- 商品页 HTML 内嵌商品 JSON/JSON-LD,含价格、卖家、CSRF token;下单端点与下载 URL 需在实现阶段用一次真实抓包确认,代码集中常量化,便于站点改版时单点更新。
- 参考社区项目(仅参考,不自研时避免直接复制代码):[BoothDownloader](https://github.com/Myrkie/BoothDownloader)、[koishi-plugin-booth-get](https://www.npmjs.com/package/koishi-plugin-booth-get)、[booth-pm-api 主题](https://repos.ecosyste.ms/topics/booth-pm-api)。

## 附:合规边界(写入 README)

- 只操作自己的账号,领取/下载自己拥有的商品;不绕过支付、不伪装会员、不代他人抢购。
- 付费商品仅生成待支付订单,支付永远在浏览器手动完成,SDK 不执行任何支付操作。
- 批量领取默认并发 1、可配置,避免对站方造成压力;不鼓励囤积转售。
