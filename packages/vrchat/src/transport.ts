/**
 * 传输层 —— VRChat 官方 REST API 的 HTTP 客户端。
 * 职责:base URL / 强制 User-Agent / 认证 cookie 携带 / 429 限流退避 / 错误归类。
 * 不感知业务,只提供 request / requestRaw。
 */
import { VrchatError } from "./errors.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface VrchatRequestOptions {
  method: HttpMethod;
  /** 请求路径,如 "/users/{id}"(不含 base URL 前缀)。 */
  path: string;
  /** URL query 参数。 */
  params?: Record<string, string | number | undefined>;
  /** JSON 请求体。 */
  json?: unknown;
  /** 请求超时(毫秒),缺省用客户端默认值。 */
  timeoutMs?: number;
}

export interface RawResponse {
  status: number;
  /** JSON 解析后的 body;无 body 时为 undefined。 */
  body: unknown;
  /** 响应头(用于 Set-Cookie / X-RateLimit-*)。 */
  headers: Headers;
}

export interface VrchatTransportOptions {
  baseUrl?: string;
  cookie?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  userAgent?: string;
}

/** 传输层。 */
export class VrchatHttpTransport {
  readonly #baseUrl: string;
  readonly #fetchImpl: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #userAgent: string;
  #cookie: string | undefined;

  constructor(options: VrchatTransportOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? "https://api.vrchat.cloud/api/1").replace(/\/+$/, "");
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#userAgent =
      options.userAgent ?? "sakurachiyo0v0-ts-dev-kits/0.1.0 (Node.js)";
    this.#cookie = options.cookie;
  }

  /** 当前会话 cookie。 */
  get cookie(): string | undefined {
    return this.#cookie;
  }

  /** API 基地址(登录请求复用)。 */
  get baseUrl(): string {
    return this.#baseUrl;
  }

  /** User-Agent(登录请求复用)。 */
  get userAgent(): string {
    return this.#userAgent;
  }

  /** fetch 实现(登录请求复用)。 */
  get fetchImpl(): typeof fetch {
    return this.#fetchImpl;
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
  async request<T>(options: VrchatRequestOptions): Promise<T> {
    const raw = await this.requestRaw(options);
    return raw.body as T;
  }

  /**
   * 发送请求并返回原始响应(状态码 + body + headers)。
   * 按 HTTP 状态归类错误:401→AUTH_EXPIRED,403→FORBIDDEN,404→NOT_FOUND,
   * 429→RATE_LIMIT(带 retryAfterSeconds),其余非 2xx→API_ERROR(UNKNOWN)。
   * 429 自动退避重试(幂等方法;写方法同样退避,因为 429 是服务端限流而非业务失败)。
   */
  async requestRaw(options: VrchatRequestOptions): Promise<RawResponse> {
    const url = this.#buildUrl(options.path, options.params);
    const headers = new Headers({
      "user-agent": this.#userAgent,
      accept: "application/json",
    });
    if (this.#cookie !== undefined) {
      headers.set("cookie", this.#cookie);
    }
    if (options.json !== undefined) {
      headers.set("content-type", "application/json");
    }

    let attempt = 0;
    for (;;) {
      const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await this.#fetchImpl(url, {
          method: options.method,
          headers,
          ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
          signal: controller.signal,
        });
      } catch (error) {
        const err = error as Error;
        if (err.name === "AbortError") {
          throw new VrchatError("TIMEOUT", `请求超时(${timeoutMs}ms): ${options.method} ${options.path}`, {
            cause: error,
          });
        }
        throw new VrchatError("NETWORK", `网络请求失败: ${options.method} ${options.path}`, {
          cause: error,
        });
      } finally {
        clearTimeout(timer);
      }

      const body = await this.#parseBody(response);

      if (response.status === 429 && attempt < this.#maxRetries) {
        const retryAfter = this.#retryAfterSeconds(response.headers);
        const delayMs = (retryAfter ?? 1) * 1000;
        attempt += 1;
        await sleep(delayMs);
        continue;
      }

      if (response.status === 401) {
        throw new VrchatError("AUTH_EXPIRED", "会话已失效,请重新登录", { statusCode: 401 });
      }
      if (response.status === 403) {
        throw new VrchatError("FORBIDDEN", "权限不足", { statusCode: 403 });
      }
      if (response.status === 404) {
        throw new VrchatError("NOT_FOUND", `资源不存在: ${options.path}`, { statusCode: 404 });
      }
      if (response.status === 429) {
        const retryAfterSeconds = this.#retryAfterSeconds(response.headers);
        throw new VrchatError("RATE_LIMIT", "请求过于频繁,已被限流", {
          statusCode: 429,
          ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        });
      }
      if (!response.ok) {
        throw new VrchatError("UNKNOWN", `VRChat API 错误(HTTP ${response.status})`, {
          statusCode: response.status,
        });
      }

      return { status: response.status, body, headers: response.headers };
    }
  }

  /** 关闭传输层(无独立资源,保留接口占位)。 */
  async close(): Promise<void> {
    // VRChat API 无长连接;预留 close 便于未来扩展与接口一致。
  }

  #buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
    const url = new URL(`${this.#baseUrl}${path}`);
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
