/**
 * weapi 会话 —— 携带 cookie 发送加密请求并校验响应。
 * 所有 /weapi/* 接口统一走这里:参数加密、cookie 注入、非 200 code 抛错。
 */
import { createLogger } from "@sakurachiyo0v0/logger";
import { NeteaseError, checkApiResponse, toNeteaseError } from "../errors.js";
import { weapiEncrypt, eapiEncrypt, eapiDecrypt } from "../weapi/encrypt.js";

const logger = createLogger({ namespace: "netease-music" }).child("session");

const DEFAULT_BASE_URL = "https://music.163.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface NeteaseCredentials {
  /** 完整 cookie 字符串,如 "MUSIC_U=...; __csrf=..."。 */
  cookies: string;
  /** csrf token(用于写操作,如收藏/歌单;下载场景主要用于身份一致)。 */
  csrf?: string;
  /** 用户 ID(可选)。 */
  userId?: string;
  /** 兼容通用 PlatformCredentials(Record<string, unknown>)。 */
  [key: string]: unknown;
}

/** 解析 cookie 字符串为键值对象。 */
export function parseCookieString(cookie: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key !== "") {
      result[key] = value;
    }
  }
  return result;
}

/** 序列化 cookie 对象为字符串。 */
export function cookieStringify(cookieMap: Record<string, string>): string {
  return Object.entries(cookieMap)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

/** 从 Set-Cookie 响应头提取 cookie 字符串(登录时用)。 */
export function collectSetCookies(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  const setCookies = headers.getSetCookie?.() ?? [];
  for (const header of setCookies) {
    const eq = header.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = header.slice(0, eq).trim();
    const value = header.slice(eq + 1).split(";")[0]?.trim() ?? "";
    if (key !== "") {
      result[key] = value;
    }
  }
  return result;
}

export interface WeapiSessionOptions {
  cookie?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** 是否在请求头附上 cookie(登录二维码接口之前可能没有 cookie)。 */
  attachCookie?: boolean;
}

/** weapi 加密请求会话。 */
export class WeapiSession {
  readonly #baseUrl: string;
  readonly #fetchImpl: typeof fetch;
  #cookieMap: Record<string, string>;

  constructor(options: WeapiSessionOptions = {}) {
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#cookieMap = options.cookie !== undefined ? parseCookieString(options.cookie) : {};
    if (this.#cookieMap.MUSIC_U === undefined) {
      // 匿名场景:网易云需要基础 cookie(os/appver)才稳定返回;
      // 缺少 appver 会被风控拦截(code -462"网络环境存在风险")。
      this.#cookieMap.os = "pc";
      this.#cookieMap.appver = "8.9.70";
    }
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  /** 当前 cookie 字符串(脱敏打印用不到,供 API 层传 csrf)。 */
  get cookie(): string {
    return cookieStringify(this.#cookieMap);
  }

  /** 合并 Set-Cookie 到会话。 */
  mergeCookies(additional: Record<string, string>): void {
    for (const [key, value] of Object.entries(additional)) {
      if (value !== "") {
        this.#cookieMap[key] = value;
      }
    }
  }

  /** 覆盖/设置单个 cookie。 */
  setCookie(name: string, value: string): void {
    this.#cookieMap[name] = value;
  }

  /** 读取单个 cookie 值。 */
  cookieValue(name: string): string | undefined {
    return this.#cookieMap[name];
  }

  /**
   * 发送 weapi 加密请求。
   * @param path 如 "/weapi/song/enhance/player/url/v1"
   * @param payload 明文参数(会注入 csrf_token)
   * @returns 校验通过的响应 body(record)
   */
  async post(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = { csrf_token: this.#cookieMap.__csrf ?? "", ...payload };
    const { params, encSecKey } = weapiEncrypt(body);
    const form = new URLSearchParams({ params, encSecKey });

    let response: Response;
    try {
      response = await this.#fetchImpl(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers: {
          "user-agent": USER_AGENT,
          referer: `${this.#baseUrl}/`,
          cookie: this.cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
    } catch (error) {
      throw new NeteaseError("NETWORK", `weapi request failed (${path})`, { cause: error });
    }
    if (!response.ok) {
      logger.error("weapi request failed", { path, status: response.status });
      throw new NeteaseError("API_ERROR", `weapi request failed (${path}): HTTP ${response.status}`, {
        apiCode: response.status,
      });
    }
    // 登录类接口成功时会 Set-Cookie,合并进会话。
    const setCookies = collectSetCookies(response.headers);
    if (Object.keys(setCookies).length > 0) {
      this.mergeCookies(setCookies);
    }
    let bodyRecord: unknown;
    try {
      bodyRecord = (await response.json()) as unknown;
    } catch (error) {
      throw new NeteaseError("API_ERROR", `weapi response is not JSON (${path})`, { cause: error });
    }
    const record = checkApiResponse(bodyRecord, path);
    logger.debug("weapi request ok", { path });
    return record;
  }

  /** 发送请求并容忍非 200 code(登录二维码 check 用;由调用方解释 code)。 */
  async postRaw(path: string, payload: Record<string, unknown>): Promise<{
    body: Record<string, unknown>;
    response: Response;
  }> {
    const body = { csrf_token: this.#cookieMap.__csrf ?? "", ...payload };
    const { params, encSecKey } = weapiEncrypt(body);
    const form = new URLSearchParams({ params, encSecKey });
    let response: Response;
    try {
      response = await this.#fetchImpl(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers: {
          "user-agent": USER_AGENT,
          referer: `${this.#baseUrl}/`,
          cookie: this.cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
    } catch (error) {
      throw new NeteaseError("NETWORK", `weapi request failed (${path})`, { cause: error });
    }
    let bodyRecord: unknown;
    try {
      bodyRecord = (await response.json()) as unknown;
    } catch (error) {
      throw new NeteaseError("API_ERROR", `weapi response is not JSON (${path})`, { cause: error });
    }
    const record = (typeof bodyRecord === "object" && bodyRecord !== null
      ? bodyRecord
      : {}) as Record<string, unknown>;
    return { body: record, response };
  }

  /**
   * 发送 eapi 加密请求(少部分接口如收藏/取消收藏歌单用 eapi,非 weapi)。
   * 请求参数:params = AES-ECB(固定 key)大写 hex。
   * 响应:eapi 响应体是 AES-ECB 加密后的大写 hex,需解密为 JSON。
   * @param path 如 "/eapi/playlist/subscribe"
   * @param payload 明文参数
   * @returns 解密并校验后的响应 body
   */
  async postEapi(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = { csrf_token: this.#cookieMap.__csrf ?? "", ...payload };
    const { params } = eapiEncrypt(path, body);
    const form = new URLSearchParams({ params });

    let response: Response;
    try {
      response = await this.#fetchImpl(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers: {
          "user-agent": USER_AGENT,
          referer: `${this.#baseUrl}/`,
          cookie: this.cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
    } catch (error) {
      throw new NeteaseError("NETWORK", `eapi request failed (${path})`, { cause: error });
    }
    if (!response.ok) {
      throw new NeteaseError("API_ERROR", `eapi request failed (${path}): HTTP ${response.status}`, {
        apiCode: response.status,
      });
    }
    const setCookies = collectSetCookies(response.headers);
    if (Object.keys(setCookies).length > 0) {
      this.mergeCookies(setCookies);
    }
    let hexText: string;
    try {
      hexText = await response.text();
    } catch (error) {
      throw new NeteaseError("API_ERROR", `eapi response read failed (${path})`, { cause: error });
    }
    const trimmed = hexText.trim();
    if (!/^[0-9a-fA-F]+$/u.test(trimmed)) {
      throw new NeteaseError("API_ERROR", `eapi response is not hex (${path})`, {
        cause: trimmed.slice(0, 120),
      });
    }
    let decrypted: string;
    try {
      decrypted = eapiDecrypt(trimmed);
    } catch (error) {
      throw new NeteaseError("API_ERROR", `eapi response decrypt failed (${path})`, {
        cause: error,
      });
    }
    let bodyRecord: unknown;
    try {
      bodyRecord = JSON.parse(decrypted) as unknown;
    } catch (error) {
      throw new NeteaseError("API_ERROR", `eapi decrypted body is not JSON (${path})`, {
        cause: error,
      });
    }
    return checkApiResponse(bodyRecord, path);
  }
}

export { toNeteaseError };
