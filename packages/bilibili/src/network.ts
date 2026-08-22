import { createHash } from "node:crypto";
import { BilibiliError, checkApiResponse, toBilibiliError } from "./errors.js";

/** B 站 WBI 签名 mixinKeyEncTab(与 Bili23-Downloader 一致)。 */
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function getMixinKey(orig: string): string {
  let result = "";
  for (const index of MIXIN_KEY_ENC_TAB) {
    result += orig[index];
  }
  return result.slice(0, 32);
}

/** 基础 Cookie(未登录也可用)。 */
function baseCookies(): Record<string, string> {
  return {
    _uuid: "FFFFFFFF-FFFF-4B5E-8BE0-FFFFFFFFFFFF" + Math.floor(Math.random() * 1e7) + "infoc",
    b_nut: String(Math.floor(Date.now() / 1000)),
    CURRENT_FNVAL: "4048",
    buvid3: `BVID3${Math.random().toString(36).slice(2, 12)}${Date.now()}`,
    buvid4: `BVID4${Math.random().toString(36).slice(2, 12)}${Date.now()}`,
  };
}

/** WBI 签名器:自动获取 img_key/sub_key。 */
export class WbiSigner {
  #imgKey = "";
  #subKey = "";
  #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  async #ensureKeys(): Promise<void> {
    if (this.#imgKey !== "" && this.#subKey !== "") {
      return;
    }
    const body = await this.#session.getRaw(
      `${this.#session.baseUrl}/x/web-interface/nav`,
      {},
    );
    // nav 在未登录时 code=-101 但 data.wbi_img 依然存在,直接读 wbi_img 即可。
    const record = (typeof body === "object" && body !== null ? body : {}) as Record<
      string,
      unknown
    >;
    const data = (record.data ?? {}) as Record<string, unknown>;
    const wbiImg = (data.wbi_img ?? {}) as Record<string, unknown>;
    const imgUrl = String(wbiImg.img_url ?? "");
    const subUrl = String(wbiImg.sub_url ?? "");
    if (imgUrl === "" || subUrl === "") {
      throw new BilibiliError("API_ERROR", "Failed to get wbi img/sub keys");
    }
    this.#imgKey = imgUrl.split("/").pop()?.split(".")[0] ?? "";
    this.#subKey = subUrl.split("/").pop()?.split(".")[0] ?? "";
  }

  /** 对参数做 WBI 签名,返回带 wts 和 w_rid 的查询字符串。 */
  async sign(params: Record<string, string | number>): Promise<string> {
    await this.#ensureKeys();
    const mixinKey = getMixinKey(this.#imgKey + this.#subKey);
    const signed: Record<string, string> = { ...Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, String(value)]),
    ) };
    signed.wts = String(Math.floor(Date.now() / 1000));
    const sortedKeys = Object.keys(signed).sort();
    const query = sortedKeys
      .map((key) => {
        const value = signed[key] ?? "";
        const cleaned = value.replace(/[!'()*]/gu, "");
        return `${encodeURIComponent(key)}=${encodeURIComponent(cleaned)}`;
      })
      .join("&");
    const hash = createHash("md5");
    hash.update(query + mixinKey);
    signed.w_rid = hash.digest("hex");
    return new URLSearchParams(signed).toString();
  }
}

/** API 会话:统一管理请求头/cookie/签名。 */
export class ApiSession {
  readonly wbi: WbiSigner;
  cookie: string;
  readonly userAgent: string;
  /** API 根地址,默认 https://api.bilibili.com(测试可覆盖)。 */
  readonly baseUrl: string;
  /** 登录态失效(-101)时的回调:返回 true 表示已刷新 cookie,调用方应重试一次。 */
  onAuthFailure?: () => Promise<boolean>;

  constructor(options: { cookie?: string; userAgent?: string; baseUrl?: string } = {}) {
    this.cookie = options.cookie ?? "";
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.baseUrl = (options.baseUrl ?? "https://api.bilibili.com").replace(/\/+$/u, "");
    this.wbi = new WbiSigner(this);
  }

  /** 更新 cookie(登录/续期后调用)。 */
  setCookie(cookie: string): void {
    this.cookie = cookie;
  }

  /** 请求头。 */
  headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "user-agent": this.userAgent,
      referer: "https://www.bilibili.com/",
      accept: "application/json, text/plain, */*",
    };
    if (this.cookie !== "") {
      // 合并基础 cookie 与用户 cookie,用户 cookie 优先。
      const cookies = { ...baseCookies(), ...parseCookieString(this.cookie) };
      headers.cookie = Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");
    }
    return headers;
  }

  /** 发起 GET 请求,返回解析后的 JSON。 */
  async getRaw(
    url: string,
    params: Record<string, string | number>,
  ): Promise<unknown> {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    ).toString();
    const fullUrl = query === "" ? url : `${url}?${query}`;
    try {
      const response = await fetch(fullUrl, { headers: this.headers() });
      const text = await response.text();
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw toBilibiliError(error);
    }
  }

  /** 发起带 WBI 签名的 GET 请求,返回校验后的 data。 */
  async get<T = unknown>(
    url: string,
    params: Record<string, string | number>,
  ): Promise<T> {
    const signedQuery = await this.wbi.sign(params);
    const fullUrl = `${url}?${signedQuery}`;
    const record = await this.#checkedJson(fullUrl);
    return record.data as T;
  }

  /** 发起普通 GET 请求(不带 WBI 签名),返回校验后的 data。 */
  async getPlain<T = unknown>(
    url: string,
    params: Record<string, string | number>,
  ): Promise<T> {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    ).toString();
    const fullUrl = query === "" ? url : `${url}?${query}`;
    const record = await this.#checkedJson(fullUrl);
    return record.data as T;
  }

  /** fetch + JSON 解析,网络错误归一为 BilibiliError。 */
  async #fetchJson(fullUrl: string): Promise<unknown> {
    try {
      const response = await fetch(fullUrl, { headers: this.headers() });
      const text = await response.text();
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw toBilibiliError(error);
    }
  }

  /** 校验 API 响应;遇到登录态失效(-101)且有续期回调时,刷新后重试一次。 */
  async #checkedJson(fullUrl: string): Promise<Record<string, unknown>> {
    const attempt = async (): Promise<Record<string, unknown>> =>
      checkApiResponse(await this.#fetchJson(fullUrl), fullUrl);
    try {
      return await attempt();
    } catch (error) {
      if (
        error instanceof BilibiliError &&
        error.apiCode === -101 &&
        this.onAuthFailure !== undefined
      ) {
        const refreshed = await this.onAuthFailure();
        if (refreshed) {
          return attempt();
        }
      }
      throw error;
    }
  }
}

/** 解析 cookie 字符串为对象。 */
export function parseCookieString(cookie: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed === "") {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return result;
}
