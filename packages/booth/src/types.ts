/**
 * BOOTH SDK 公共类型 —— 字段语义的权威定义。
 * 与 netease-music / bilibili 同构:核心接口在类型层,供应商适配细节收敛在 api/ 模块。
 */
import type { ConfigNamespace } from "@sakurachiyo0v0/config";

/** 商品基础信息(从商品页解析)。 */
export interface BoothItem {
  /** 数字字符串商品 ID。 */
  id: string;
  /** 商品标题。 */
  title: string;
  /** 价格(日元),0 表示免费。 */
  priceYen: number;
  /** 卖家店铺 ID(店铺子域名前缀)。 */
  shopId: string;
  /** 卖家店铺名(可选)。 */
  shopName?: string;
  /** 当前登录账号是否已拥有(页面按钮态判断)。 */
  alreadyOwned: boolean;
  /** 免费商品:downloadables 下载链接(302 → S3 直链)。付费商品不存在此字段。 */
  downloadUrl?: string;
  /** 商品变体 ID(加购/下载请求用)。 */
  variationId?: string;
  /** 页面 CSRF token(authenticity_token)。 */
  csrfToken: string;
}

/** 商品的一个购买项(variation)。一个商品可有多个购买项(如免费版/标准版/豪华版)。 */
export interface BoothVariation {
  /** 购买项 ID(variation_id,加购/下载请求用)。 */
  id: string;
  /** 购买项名称(如「無料版【全10種】」「有料版【全118種】」)。 */
  name: string;
  /** 价格(日元),0 表示该购买项免费。 */
  priceYen: number;
  /** 是否免费购买项。 */
  free: boolean;
  /** 免费购买项:downloadables 下载链接(302 → S3 直链)。 */
  downloadUrl?: string;
  /** 免费购买项:从 downloadUrl 提取的 variation_id(与 id 相同)。 */
  variationId?: string;
}

/** 商品详情 = 基础信息 + 简介/正文 + 全部购买项(按需获取)。 */
export interface BoothItemDetail extends BoothItem {
  /** 简介/正文介绍(JSON-LD description,含换行)。 */
  description: string;
  /** 全部购买项(含免费/付费;商品只有一个购买项时数组长度为 1)。 */
  variations: BoothVariation[];
}

/** 获取商品详情的字段选择(按需获取,减少 token 浪费)。 */
export interface ItemDetailOptions {
  /** 是否包含简介/正文(description)。默认 true。 */
  description?: boolean;
  /** 是否包含购买项列表(variations)。默认 true。 */
  variations?: boolean;
}

/** 单个商品领取结果状态。 */
export type ClaimStatus =
  | "claimed" // 免费商品:已领取,可直接下载
  | "paid-pending" // 付费商品:已加入购物车,需浏览器手动完成支付
  | "skipped"; // 已拥有,跳过,不算失败

/** 单个商品领取结果。 */
export interface ClaimResult {
  /** 原始输入(链接或 ID)。 */
  input: string;
  /** 商品 ID。 */
  itemId: string;
  /** 状态:claimed / paid-pending / skipped / failed。 */
  status: ClaimStatus | "failed";
  /** 免费商品:下载直链(downloadables → S3 302 后的最终 URL)。 */
  downloadUrl?: string;
  /** paid-pending:购物车/结算页 URL(浏览器手动完成支付)。 */
  payUrl?: string;
  /** failed 时的错误信息(已脱敏)。 */
  error?: { code: string; message: string };
}

/** 下载进度回调快照。 */
export interface DownloadProgress {
  /** 文件名。 */
  fileName: string;
  /** 当前文件已下载字节数。 */
  received: number;
  /** 当前文件总字节数(未知时为 0)。 */
  total: number;
}

/** 下载配置。 */
export interface DownloadConfig {
  /** 单文件重试次数,默认 2。 */
  retries?: number;
  /** 限速(字节/秒),默认不限。 */
  rateLimitBps?: number;
  /** 已存在同名文件跳过,默认 true。 */
  skipExisting?: boolean;
}

/** 领取(批量)配置。 */
export interface ClaimConfig {
  /** 批量领取并发,默认 1(避免站方压力)。 */
  concurrency?: number;
}

/** 客户端配置。 */
export interface BoothClientOptions {
  /** 显式会话 cookie 头字符串(优先于 AuthStore)。 */
  cookie?: string;
  /** AuthStore 自定义路径(缺省用平台默认 <配置根>/amechan/booth/auth.json)。 */
  authPath?: string;
  /**
   * 可选远程登录态命名空间(配置中心加密域,如 createConfigCenter().namespace("auth",{encrypt:true}))。
   * 登录态双写本地+远程;新机还原:先 await new AuthStore({platform:"booth",remote}).load()。
   */
  remote?: ConfigNamespace;
  /** 覆盖站点基地址(测试用 mock / 自定义网关)。 */
  baseUrl?: string;
  /** 注入 fetch(测试用)。 */
  fetchImpl?: typeof fetch;
  /** 下载配置。 */
  download?: DownloadConfig;
  /** 领取配置。 */
  claim?: ClaimConfig;
}

/** 登录捕获选项(编程调用 loginBooth)。 */
export interface BoothLoginOptions {
  /** AuthStore 自定义路径。 */
  authPath?: string;
  /**
   * 可选远程登录态命名空间(配置中心加密域)。登录态双写本地+远程,
   * 换机后先 await new AuthStore({platform:"booth",remote}).load() 还原。
   */
  remote?: ConfigNamespace;
  /** 自定义浏览器打开器(便于测试);CDP 自动登录时不生效。 */
  openBrowser?: (url: string) => void | Promise<void>;
  /** 注入 fetch(测试用)。 */
  fetchImpl?: typeof fetch;
  /** 登录页 URL(默认官方登录页)。 */
  loginUrl?: string;
  /** 登录过程日志回调(CDP 模式)。 */
  onLog?: (message: string) => void;
  /** 是否使用 CDP 自动浏览器登录;默认 true(检测到 Chrome/Edge 时)。显式 false 走捕获页(测试/无头环境)。 */
  useCdp?: boolean;
  /**
   * 复用日常浏览器 profile 的登录态(免重新输入账号密码)。
   * 默认 false:用临时 profile(隔离,不碰日常浏览器)。
   * 为 true 时:定位本机 Chrome/Edge 默认 User Data 目录启动,直接使用其中已登录的会话;
   * 若该浏览器正在运行会报错提示先关闭。
   */
  reuseBrowserProfile?: boolean;
}

/** 领取并下载的一条龙结果。 */
export interface ClaimAndDownloadResult {
  /** 领取结果。 */
  claim: ClaimResult;
  /** 已下载文件的绝对路径列表。 */
  files: string[];
}
