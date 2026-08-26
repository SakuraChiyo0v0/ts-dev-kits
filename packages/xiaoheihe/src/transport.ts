/**
 * HTTP 传输层 —— api.xiaoheihe.cn 统一请求通道。
 * 职责:base URL / 签名参数(hkey/nonce/_time)注入 / 固定公共参数 / 会话 cookie 携带 /
 *       请求头(host/referer)/ 风控识别(captcha/ticket)/ 错误归类 / 脱敏日志。
 * 不感知业务,只提供 request。
 */
import type { QrLoginAdapter } from "@sakurachiyo0v0/account";
import { createLogger } from "@sakurachiyo0v0/logger";
import { XiaoheiheError, toXiaoheiheError } from "./errors.js";
import { getKeys } from "./sign.js";

const logger = createLogger({ namespace: "xiaoheihe" }).child("transport");

export type HttpMethod = "GET" | "POST";

/**
 * fetch 实现类型 —— 以 account 接口的 fetch 声明为唯一来源,
 * 避免 lib.dom 与 @types/node 两套全局 fetch 类型互相冲突。
 */
export type XiaoheiheFetch = Parameters<QrLoginAdapter["generateKey"]>[0];

export interface XiaoheiheRequestOptions {
  /** 请求路径(不含 base URL,如 /bbs/app/link/tree;签名基于此路径)。 */
  path: string;
  method?: HttpMethod;
  /** URL query 参数(签名与公共参数自动追加)。 */
  params?: Record<string, string | number | undefined>;
  /** application/x-www-form-urlencoded 请求体(POST 用;不参与签名)。 */
  form?: Record<string, string | number | boolean>;
  /** 附加请求头。 */
  headers?: Record<string, string>;
  /** 请求超时(毫秒),缺省用客户端默认值。 */
  timeoutMs?: number;
}

export interface XiaoheiheTransportOptions {
  /** 覆盖 base URL(测试 mock 用)。 */
  baseUrl?: string;
  /** 注入 fetch 实现(测试用)。 */
  fetchImpl?: XiaoheiheFetch;
  /** 请求超时(毫秒),默认 15000。 */
  timeoutMs?: number;
  /** device_id 公共参数,默认 "test-device-001"(与参考实现配置一致)。 */
  deviceId?: string;
  /** version 公共参数,默认 "999.0.4"。 */
  version?: string;
  /** web_version 公共参数,默认 "2.5"。 */
  webVersion?: string;
  /** 脱敏请求日志(仅 method / path / status)。 */
  logger?: (line: string) => void;
}

/** 小黑盒传输层。 */
export class XiaoheiheHttpTransport {
  readonly #baseUrl: string;
  readonly #fetchImpl: XiaoheiheFetch;
  readonly #timeoutMs: number;
  readonly #deviceId: string;
  readonly #version: string;
  readonly #webVersion: string;
  readonly #logger: ((line: string) => void) | undefined;
  #cookie: string | undefined;

  constructor(options: XiaoheiheTransportOptions = {}) {
    this.#baseUrl = options.baseUrl ?? "https://api.xiaoheihe.cn";
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#deviceId = options.deviceId ?? "test-device-001";
    this.#version = options.version ?? "999.0.4";
    this.#webVersion = options.webVersion ?? "2.5";
    this.#logger = options.logger;
  }

  /** 当前会话 cookie。 */
  get cookie(): string | undefined {
    return this.#cookie;
  }

  /** 注入会话 cookie(登录成功后 / 显式 cookie 时调用)。 */
  setCookie(cookie: string): void {
    this.#cookie = cookie;
  }

  /** 清除会话 cookie(登出时调用)。 */
  clearCookie(): void {
    this.#cookie = undefined;
  }

  /**
   * 发送请求并返回解析后的 JSON(由调用方断言类型)。
   * 自动注入签名与公共参数;响应 `status` 非 ok 时抛错;
   * 风控信号(响应体含 captcha/ticket 或 status 为 show_captcha/error_captcha)抛 CAPTCHA。
   */
  async request<T>(options: XiaoheiheRequestOptions): Promise<T> {
    const method = options.method ?? "GET";
    const { hkey, nonce, time } = getKeys(options.path);
    const url = new URL(`${this.#baseUrl}${options.path}`);

    // 业务参数
    if (options.params !== undefined) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    // 签名参数
    url.searchParams.set("hkey", hkey);
    url.searchParams.set("_time", String(time));
    url.searchParams.set("nonce", nonce);
    // 固定公共参数(与 sendreq.go 一致)
    url.searchParams.set("os_type", "web");
    url.searchParams.set("app", "web");
    url.searchParams.set("client_type", "web");
    url.searchParams.set("version", this.#version);
    url.searchParams.set("web_version", this.#webVersion);
    url.searchParams.set("x_client_type", "web");
    url.searchParams.set("x_app", "heybox_website");
    url.searchParams.set("x_os_type", "Windows");
    url.searchParams.set("device_info", "Chrome");
    url.searchParams.set("device_id", this.#deviceId);
    url.searchParams.set("_notip", "true");

    const headers = new Headers({
      host: new URL(this.#baseUrl).host,
      referer: "https://www.xiaoheihe.cn/",
      accept: "application/json, text/plain, */*",
    });
    if (options.headers !== undefined) {
      for (const [key, value] of Object.entries(options.headers)) {
        headers.set(key, value);
      }
    }
    if (this.#cookie !== undefined && this.#cookie !== "") {
      headers.set("cookie", this.#cookie);
    }

    let body: BodyInit | undefined;
    if (options.form !== undefined) {
      body = new URLSearchParams(
        Object.entries(options.form).map(([key, value]) => [key, String(value)]),
      ).toString();
      headers.set("content-type", "application/x-www-form-urlencoded;charset=utf-8");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetchImpl(url.toString(), {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new XiaoheiheError("TIMEOUT", `请求超时: ${method} ${options.path}`, { cause: error });
      }
      throw toXiaoheiheError(error, `网络请求失败: ${method} ${options.path}`);
    } finally {
      clearTimeout(timer);
    }

    this.#logger?.(`${method} ${options.path} -> ${response.status}`);
    const text = await response.text();
    const payload = this.#parsePayload(text);

    // 风控信号:响应体含 captcha/ticket(风控页特征)
    if (text.includes("captcha") || text.includes("ticket")) {
      logger.warn("risk control triggered (captcha/ticket in response)", {
        method,
        path: options.path,
      });
      throw new XiaoheiheError("CAPTCHA", "触发小黑盒风控验证码拦截,请稍后再试", {
        statusCode: response.status,
      });
    }

    if (response.status === 401) {
      logger.warn("auth expired", { method, path: options.path });
      throw new XiaoheiheError("AUTH_EXPIRED", "登录态已失效,请重新扫码登录", { statusCode: 401 });
    }
    if (response.status === 429) {
      const retryAfterSeconds = this.#retryAfterSeconds(response.headers);
      logger.warn("rate limited", { method, path: options.path, retryAfterSeconds });
      throw new XiaoheiheError("RATE_LIMIT", "请求过于频繁,已被限流", {
        statusCode: 429,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      });
    }
    if (!response.ok) {
      logger.error("api error", { method, path: options.path, status: response.status });
      throw new XiaoheiheError("API_ERROR", `接口错误(HTTP ${response.status})`, {
        statusCode: response.status,
      });
    }

    // 业务状态:status 字段(show_captcha / error_captcha 属风控)
    if (payload !== null && typeof payload === "object") {
      const status = (payload as { status?: unknown }).status;
      const msg = (payload as { msg?: unknown }).msg;
      const statusText = typeof status === "string" ? status : "";
      if (statusText === "show_captcha" || statusText === "error_captcha") {
        logger.warn("risk control triggered (status field)", { method, path: options.path });
        throw new XiaoheiheError("CAPTCHA", "触发小黑盒风控验证码拦截,请稍后再试", {
          ...(typeof msg === "string" && msg !== "" ? { serverMsg: msg } : {}),
        });
      }
      if (statusText !== "" && statusText !== "ok") {
        logger.error("api returned non-ok status", {
          method,
          path: options.path,
          statusText,
        });
        throw new XiaoheiheError("API_ERROR", "小黑盒接口返回异常", {
          ...(typeof msg === "string" && msg !== "" ? { serverMsg: msg } : {}),
        });
      }
    }

    logger.debug("request ok", { method, path: options.path, status: response.status });
    return payload as T;
  }

  /**
   * 发送请求并返回原始响应(状态码 + 响应头 + 解析后 body),不抛业务错误、
   * 不检查 status 字段 —— 登录流程用(需要读 Set-Cookie / 区分扫码状态)。
   * 签名与公共参数照常注入。
   */
  async requestRaw<T>(options: XiaoheiheRequestOptions): Promise<{
    status: number;
    headers: Headers;
    body: T;
  }> {
    const method = options.method ?? "GET";
    const { hkey, nonce, time } = getKeys(options.path);
    const url = new URL(`${this.#baseUrl}${options.path}`);

    if (options.params !== undefined) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    url.searchParams.set("hkey", hkey);
    url.searchParams.set("_time", String(time));
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("os_type", "web");
    url.searchParams.set("app", "web");
    url.searchParams.set("client_type", "web");
    url.searchParams.set("version", this.#version);
    url.searchParams.set("web_version", this.#webVersion);
    url.searchParams.set("x_client_type", "web");
    url.searchParams.set("x_app", "heybox_website");
    url.searchParams.set("x_os_type", "Windows");
    url.searchParams.set("device_info", "Chrome");
    url.searchParams.set("device_id", this.#deviceId);
    url.searchParams.set("_notip", "true");

    const headers = new Headers({
      host: new URL(this.#baseUrl).host,
      referer: "https://www.xiaoheihe.cn/",
      accept: "application/json, text/plain, */*",
    });
    if (this.#cookie !== undefined && this.#cookie !== "") {
      headers.set("cookie", this.#cookie);
    }

    let body: BodyInit | undefined;
    if (options.form !== undefined) {
      body = new URLSearchParams(
        Object.entries(options.form).map(([key, value]) => [key, String(value)]),
      ).toString();
      headers.set("content-type", "application/x-www-form-urlencoded;charset=utf-8");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetchImpl(url.toString(), {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new XiaoheiheError("TIMEOUT", `请求超时: ${method} ${options.path}`, { cause: error });
      }
      throw toXiaoheiheError(error, `网络请求失败: ${method} ${options.path}`);
    } finally {
      clearTimeout(timer);
    }

    this.#logger?.(`${method} ${options.path} -> ${response.status}`);
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: this.#parsePayload(text) as T };
  }

  /** 解析响应文本为 JSON;空/非 JSON 返回原文本(由调用方处理)。 */
  #parsePayload(text: string): unknown {
    if (text === "") {
      return undefined;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  #retryAfterSeconds(headers: Headers): number | undefined {
    const value = headers.get("retry-after");
    if (value === null) {
      return undefined;
    }
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
  }
}
