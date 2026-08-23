/**
 * HTTP 传输层 —— 三台主机(api / store / community)的统一请求通道。
 * 职责:base URL 覆盖 / Web API key 注入 / 会话 cookie 携带 / 429 退避重试 /
 *       TTL 缓存 / 超时 / 代理(undici ProxyAgent)/ 错误归类 / 脱敏日志。
 * 不感知业务,只提供 request。
 */
import { ProxyAgent, type Dispatcher } from "undici";
import { SteamError, toSteamError } from "./errors.js";
import { STEAM_HOSTS, type SteamHost } from "./endpoints.js";
import type { CacheOptions } from "./types.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface SteamRequestOptions {
  host: SteamHost;
  /** 请求路径(不含 base URL 前缀)。 */
  path: string;
  method?: HttpMethod;
  /** URL query 参数。 */
  params?: Record<string, string | number | undefined>;
  /** JSON 请求体。 */
  json?: unknown;
  /** application/x-www-form-urlencoded 请求体(登录 / 部分 WebAPI 用)。 */
  form?: Record<string, string | number | boolean>;
  /** 附加请求头。 */
  headers?: Record<string, string>;
  /** 附加 Web API key(publisherKey 优先,否则 apiKey;经 X-WebAPI-Key 头)。 */
  withKey?: boolean;
  /** 附加会话 cookie(community 登录态请求)。 */
  withCookies?: boolean;
  /** 请求超时(毫秒),缺省用客户端默认值。 */
  timeoutMs?: number;
  /** 跳过 TTL 缓存(默认 GET 无 body 且缓存开启时命中)。 */
  noCache?: boolean;
  /** 返回原始文本而非 JSON 解析结果(HTML 等场景)。 */
  rawText?: boolean;
}

export interface SteamTransportOptions {
  apiKey?: string;
  publisherKey?: string;
  proxy?: string;
  baseUrls?: Partial<Record<SteamHost, string>>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  userAgent?: string;
  cache?: CacheOptions;
  cookie?: string;
  /** 脱敏请求日志(仅输出 method / host / path / status,不含 query 与凭据)。 */
  logger?: (line: string) => void;
}

interface CacheEntry {
  expiresAt: number;
  body: unknown;
}

/** Steam 传输层。 */
export class SteamHttpTransport {
  readonly #baseUrls: Record<SteamHost, string>;
  readonly #fetchImpl: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #userAgent: string;
  readonly #cacheEnabled: boolean;
  readonly #cacheTtlMs: number;
  readonly #logger: ((line: string) => void) | undefined;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #dispatcher: Dispatcher | undefined;
  #apiKey: string | undefined;
  #publisherKey: string | undefined;
  #cookie: string | undefined;

  constructor(options: SteamTransportOptions = {}) {
    this.#baseUrls = {
      api: options.baseUrls?.api ?? STEAM_HOSTS.api,
      store: options.baseUrls?.store ?? STEAM_HOSTS.store,
      community: options.baseUrls?.community ?? STEAM_HOSTS.community,
      login: options.baseUrls?.login ?? STEAM_HOSTS.login,
    };
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#userAgent =
      options.userAgent ?? "sakurachiyo0v0-ts-dev-kits/0.1.0 (Node.js)";
    this.#cacheEnabled = options.cache?.enabled ?? true;
    this.#cacheTtlMs = options.cache?.ttlMs ?? 60_000;
    this.#logger = options.logger;
    this.#apiKey = options.apiKey;
    this.#publisherKey = options.publisherKey;
    this.#cookie = options.cookie;
    if (options.proxy !== undefined && options.proxy !== "") {
      this.#dispatcher = new ProxyAgent(options.proxy);
    }
  }

  /** 当前 Web API user key。 */
  get apiKey(): string | undefined {
    return this.#apiKey;
  }

  /** 当前发行商密钥。 */
  get publisherKey(): string | undefined {
    return this.#publisherKey;
  }

  /** 当前会话 cookie。 */
  get cookie(): string | undefined {
    return this.#cookie;
  }

  /** 登录成功后注入会话 cookie。 */
  setCookie(cookie: string): void {
    this.#cookie = cookie;
  }

  /** 清除会话 cookie(登出时调用)。 */
  clearCookie(): void {
    this.#cookie = undefined;
  }

  /** 发送请求并返回解析后的 JSON(由调用方断言类型)。 */
  async request<T>(options: SteamRequestOptions): Promise<T> {
    const body = await this.#requestBody(options);
    return body as T;
  }

  /**
   * 发送请求并返回原始响应(状态码 + 响应头 + 解析后 body),不抛业务错误、
   * 不缓存、不重试 —— 认证流程用(需要读 x-eresult 响应头 / 区分状态码)。
   */
  async requestRaw<T>(options: SteamRequestOptions): Promise<{
    status: number;
    headers: Headers;
    body: T;
  }> {
    const method = options.method ?? "GET";
    const url = this.#buildUrl(options.host, options.path, options.params);
    const headers = new Headers({
      "user-agent": this.#userAgent,
      accept: "application/json",
    });
    if (options.headers !== undefined) {
      for (const [key, value] of Object.entries(options.headers)) {
        headers.set(key, value);
      }
    }
    this.#applyAuthHeaders(headers, options);
    if (options.json !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (options.form !== undefined) {
      headers.set("content-type", "application/x-www-form-urlencoded");
    }

    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.#fetchImpl(url, {
        method,
        headers,
        ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
        ...(options.form !== undefined
          ? {
              body: new URLSearchParams(
                Object.entries(options.form).map(([key, value]) => [key, String(value)]),
              ).toString(),
            }
          : {}),
        ...(this.#dispatcher !== undefined ? { dispatcher: this.#dispatcher } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new SteamError("TIMEOUT", `请求超时(${timeoutMs}ms): ${method} ${options.host}${options.path}`, {
          cause: error,
        });
      }
      throw toSteamError(error, `网络请求失败: ${method} ${options.host}${options.path}`);
    } finally {
      clearTimeout(timer);
    }

    this.#logger?.(`${method} ${options.host} ${options.path} -> ${response.status}`);
    const body = await this.#parseBody(response);
    return { status: response.status, headers: response.headers, body: body as T };
  }

  async #requestBody(options: SteamRequestOptions): Promise<unknown> {
    const method = options.method ?? "GET";
    const cacheKey = this.#cacheKey(options, method);

    if (cacheKey !== undefined) {
      const hit = this.#cache.get(cacheKey);
      if (hit !== undefined && hit.expiresAt > Date.now()) {
        return hit.body;
      }
    }

    const body = await this.#fetchOnce(options, method);

    if (cacheKey !== undefined) {
      this.#cache.set(cacheKey, { expiresAt: Date.now() + this.#cacheTtlMs, body });
    }

    return body;
  }

  async #fetchOnce(options: SteamRequestOptions, method: HttpMethod): Promise<unknown> {
    const url = this.#buildUrl(options.host, options.path, options.params);
    const headers = new Headers({
      "user-agent": this.#userAgent,
      accept: "application/json",
    });
    if (options.headers !== undefined) {
      for (const [key, value] of Object.entries(options.headers)) {
        headers.set(key, value);
      }
    }
    this.#applyAuthHeaders(headers, options);
    if (options.json !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (options.form !== undefined) {
      headers.set("content-type", "application/x-www-form-urlencoded");
    }

    let attempt = 0;
    for (;;) {
      const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await this.#fetchImpl(url, {
          method,
          headers,
          ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
          ...(options.form !== undefined
            ? {
                body: new URLSearchParams(
                  Object.entries(options.form).map(([key, value]) => [key, String(value)]),
                ).toString(),
              }
            : {}),
          ...(this.#dispatcher !== undefined ? { dispatcher: this.#dispatcher } : {}),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new SteamError("TIMEOUT", `请求超时(${timeoutMs}ms): ${method} ${options.host}${options.path}`, {
            cause: error,
          });
        }
        throw toSteamError(error, `网络请求失败: ${method} ${options.host}${options.path}`);
      } finally {
        clearTimeout(timer);
      }

      this.#logger?.(`${method} ${options.host} ${options.path} -> ${response.status}`);

      if (response.status === 429 && attempt < this.#maxRetries) {
        const retryAfter = this.#retryAfterSeconds(response.headers);
        const delayMs = Math.min((retryAfter ?? 1) * 1000, 10_000);
        attempt += 1;
        await sleep(delayMs);
        continue;
      }

      const body =
        options.rawText === true ? await response.text() : await this.#parseBody(response);

      if (response.status === 401) {
        throw new SteamError("AUTH_EXPIRED", "Steam 密钥无效或会话已失效,请重新登录", { statusCode: 401 });
      }
      if (response.status === 403) {
        throw new SteamError("FORBIDDEN", "Steam 拒绝访问(权限不足或资料未公开)", { statusCode: 403 });
      }
      if (response.status === 404) {
        throw new SteamError("NOT_FOUND", `Steam 资源不存在: ${options.host}${options.path}`, { statusCode: 404 });
      }
      if (response.status === 429) {
        const retryAfterSeconds = this.#retryAfterSeconds(response.headers);
        throw new SteamError("RATE_LIMIT", "Steam 请求过于频繁,已被限流", {
          statusCode: 429,
          ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        });
      }
      if (!response.ok) {
        throw new SteamError("UNKNOWN", `Steam 接口错误(HTTP ${response.status})`, {
          statusCode: response.status,
        });
      }

      return body;
    }
  }

  #applyAuthHeaders(headers: Headers, options: SteamRequestOptions): void {
    if (options.withKey === true) {
      const key = this.#publisherKey ?? this.#apiKey;
      if (key === undefined) {
        throw new SteamError(
          "CONFIGURATION",
          `缺少 Steam Web API key(需 apiKey 或 publisherKey): ${options.host}${options.path}`,
        );
      }
      headers.set("x-webapi-key", key);
    }
    if (options.withCookies === true && this.#cookie !== undefined) {
      headers.set("cookie", this.#cookie);
    }
  }

  #cacheKey(options: SteamRequestOptions, method: HttpMethod): string | undefined {
    if (!this.#cacheEnabled || options.noCache === true) {
      return undefined;
    }
    if (method !== "GET" || options.json !== undefined || options.form !== undefined) {
      return undefined;
    }
    const params = options.params ?? {};
    const sorted = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");
    return `${options.host}|${options.path}|${sorted}`;
  }

  #buildUrl(host: SteamHost, path: string, params?: Record<string, string | number | undefined>): string {
    const url = new URL(`${this.#baseUrls[host]}${path}`);
    if (params !== undefined) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async #parseBody(response: Response): Promise<unknown> {
    const text = await response.text();
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

  /** 关闭传输层(释放代理等资源)。 */
  async close(): Promise<void> {
    if (this.#dispatcher !== undefined && typeof this.#dispatcher.close === "function") {
      await this.#dispatcher.close();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
