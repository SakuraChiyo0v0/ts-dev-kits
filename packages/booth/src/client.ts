/**
 * BoothClient —— BOOTH SDK 统一入口。
 * 登录态:显式 cookie 优先,否则从 account AuthStore 自动加载。
 * 合规:付费商品只生成待支付订单,支付留在浏览器;批量默认并发 1。
 */
import { AccountError, AuthStore, browserLogin } from "@sakurachiyo0v0/account";
import { BoothError, isBoothErrorCode, toBoothError } from "./errors.js";
import { boothBrowserAdapter } from "./login-adapter.js";
import type {
  BoothClientOptions,
  BoothItem,
  BoothItemDetail,
  BoothLoginOptions,
  ClaimAndDownloadResult,
  ClaimResult,
} from "./types.js";
import { BoothSession } from "./session.js";
import { ItemApi } from "./api/item.js";
import { ClaimApi, toClaimResult } from "./api/order.js";
import { DownloadApi } from "./api/download.js";
import { parseBoothInput } from "./parsers/url.js";

/** BOOTH 客户端。 */
export class BoothClient {
  readonly #session: BoothSession;
  readonly #items: ItemApi;
  readonly #claims: ClaimApi;
  readonly #downloads: DownloadApi;
  readonly #claimConcurrency: number;
  readonly #authPath: string | undefined;
  readonly #downloadConfig: NonNullable<BoothClientOptions["download"]>;

  constructor(options: BoothClientOptions = {}) {
    this.#authPath = options.authPath;
    this.#session = new BoothSession({
      ...(options.cookie !== undefined ? { cookie: options.cookie } : {}),
      ...(options.authPath !== undefined ? { authPath: options.authPath } : {}),
      ...(options.remote !== undefined ? { remote: options.remote } : {}),
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    });
    this.#items = new ItemApi(this.#session);
    this.#claims = new ClaimApi(this.#session);
    this.#downloads = new DownloadApi(this.#session);
    this.#claimConcurrency = options.claim?.concurrency ?? 1;
    this.#downloadConfig = {
      ...(options.download?.retries !== undefined ? { retries: options.download.retries } : {}),
      ...(options.download?.rateLimitBps !== undefined ? { rateLimitBps: options.download.rateLimitBps } : {}),
      ...(options.download?.skipExisting !== undefined ? { skipExisting: options.download.skipExisting } : {}),
    };
  }

  /** 当前是否已登录(有会话 cookie)。 */
  get isLoggedIn(): boolean {
    return this.#session.isLoggedIn;
  }

  /** 登录态存储路径(未配置 authPath 时为 undefined)。 */
  get authPath(): string | undefined {
    return this.#authPath;
  }

  /** 解析输入:booth.pm 链接或纯数字 ID → 商品信息。 */
  async getItem(input: string): Promise<BoothItem> {
    const { itemId } = parseBoothInput(input);
    return this.#items.getItem(itemId);
  }

  /**
   * 解析商品详情(简介/正文 + 全部购买项),字段按需获取省 token。
   * getItem 的精简版不含 description/variations;需要详情时用这个方法。
   */
  async getItemDetail(
    input: string,
    options?: { description?: boolean; variations?: boolean },
  ): Promise<BoothItemDetail> {
    const { itemId } = parseBoothInput(input);
    return this.#items.getItemDetail(itemId, {
      ...(options?.description !== undefined ? { description: options.description } : {}),
      ...(options?.variations !== undefined ? { variations: options.variations } : {}),
    });
  }

  /**
   * 批量领取。输入可以是链接或纯 ID;保持输入顺序返回结果。
   * 免费直接领取(downloadUrl);付费加入购物车(payUrl,浏览器手动支付);已拥有跳过。
   * 单项失败不中断,失败项记入结果。
   */
  async claim(inputs: string[], options?: { concurrency?: number }): Promise<ClaimResult[]> {
    if (inputs.length === 0) {
      return [];
    }
    const concurrency = Math.max(1, options?.concurrency ?? this.#claimConcurrency);
    const results: ClaimResult[] = new Array(inputs.length);
    let next = 0;
    const workers: Promise<void>[] = [];
    const runWorker = async (): Promise<void> => {
      for (;;) {
        const index = next;
        if (index >= inputs.length) {
          return;
        }
        next += 1;
        const input = inputs[index];
        if (input === undefined) {
          return;
        }
        results[index] = await this.#claimOne(input);
      }
    };
    for (let i = 0; i < Math.min(concurrency, inputs.length); i += 1) {
      workers.push(runWorker());
    }
    await Promise.all(workers);
    return results;
  }

  /** 便捷:单个输入领取。 */
  async claimByInput(input: string): Promise<ClaimResult> {
    const results = await this.claim([input]);
    const result = results[0];
    if (result === undefined) {
      throw new BoothError("UNKNOWN", "claim produced no result");
    }
    return result;
  }

  /** 下载单个下载直链到 outputDir。返回绝对路径。 */
  async downloadUrl(url: string, options?: { outputDir?: string }): Promise<string> {
    return this.#downloads.downloadUrl(url, {
      ...this.#downloadConfig,
      ...(options?.outputDir !== undefined ? { outputDir: options.outputDir } : {}),
    });
  }

  /**
   * 一条龙:领取后直接下载。
   * 免费 → 领取 + 下载(downloadUrl);付费 → 返回 payUrl 不下载;已拥有/失败 → 不下载。
   */
  async claimAndDownload(
    input: string,
    options?: { outputDir?: string; skipIfPaidPending?: boolean },
  ): Promise<ClaimAndDownloadResult> {
    const claim = await this.claimByInput(input);
    if (claim.status === "paid-pending" && options?.skipIfPaidPending !== false) {
      return { claim, files: [] };
    }
    if (claim.status === "failed" || claim.status === "skipped") {
      return { claim, files: [] };
    }
    if (claim.downloadUrl === undefined) {
      return { claim, files: [] };
    }
    const files = [
      await this.#downloads.downloadUrl(claim.downloadUrl, {
        ...this.#downloadConfig,
        ...(options?.outputDir !== undefined ? { outputDir: options.outputDir } : {}),
      }),
    ];
    return { claim, files };
  }

  /** 保存当前登录态到 AuthStore。 */
  async persistLogin(authPath?: string): Promise<void> {
    await this.#session.persist(authPath);
  }

  /** 清除本地登录态。 */
  async clearLogin(authPath?: string): Promise<void> {
    await this.#session.clear(authPath);
  }

  async #claimOne(input: string): Promise<ClaimResult> {
    try {
      const { itemId } = parseBoothInput(input);
      const item = await this.#items.getItem(itemId);
      const result = await this.#claims.claim(item);
      return toClaimResult(input, itemId, result);
    } catch (error) {
      const boothError = toBoothError(error, { input });
      return {
        input,
        itemId: safeItemId(input),
        status: "failed",
        error: { code: boothError.code, message: boothError.message },
      };
    }
  }
}

/** 从输入尽量提取 itemId(失败时为原输入,仅用于失败结果展示)。 */
function safeItemId(input: string): string {
  try {
    return parseBoothInput(input).itemId;
  } catch {
    return input;
  }
}

/**
 * 浏览器登录:复用 account 的 browserLogin 骨架(CDP 自动捕获 → 捕获页回退)。
 * 平台差异(BOOTH 登录页、会话 cookie 特征、登录后校验)收敛在 boothBrowserAdapter。
 * 返回 { account, saved }。
 */
export async function loginBooth(options: BoothLoginOptions = {}): Promise<{ account: string; saved: boolean }> {
  try {
    // booth 现有行为:登录成功始终持久化(未传 authPath 用默认 <配置根>/amechan/booth/auth.json)。
    // 传 remote 时登录态双写本地+远程(配置中心加密域),换机可还原。
    const result = await browserLogin({
      adapter: boothBrowserAdapter(),
      store: new AuthStore({
        platform: "booth",
        ...(options.authPath !== undefined ? { path: options.authPath } : {}),
        ...(options.remote !== undefined ? { remote: options.remote } : {}),
      }),
      ...(options.loginUrl !== undefined ? { loginUrl: options.loginUrl } : {}),
      ...(options.openBrowser !== undefined ? { openBrowser: options.openBrowser } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.onLog !== undefined ? { onLog: options.onLog } : {}),
      ...(options.useCdp !== undefined ? { useCdp: options.useCdp } : {}),
      ...(options.reuseBrowserProfile !== undefined
        ? { reuseBrowserProfile: options.reuseBrowserProfile }
        : {}),
    });
    return { account: "booth-user", saved: result.saved };
  } catch (error) {
    // 保持 booth 公共 API 的错误类型(BoothError);AccountError 映射为同名错误码。
    if (error instanceof BoothError) {
      throw error;
    }
    if (error instanceof AccountError) {
      throw new BoothError(
        isBoothErrorCode(error.code) ? error.code : "UNKNOWN",
        error.message,
      );
    }
    throw toBoothError(error);
  }
}





/** 创建客户端。 */
export function createBoothClient(options?: BoothClientOptions): BoothClient {
  return new BoothClient(options);
}
