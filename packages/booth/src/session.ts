/**
 * 会话管理 —— 显式 cookie 优先,否则从 account AuthStore 自动加载。
 * 与 netease-music 的 WeapiSession 同构,但请求不需要加密层,直接携带 cookie 发请求。
 */
import { AuthStore } from "@sakurachiyo0v0/account";
import { BoothError } from "./errors.js";

const DEFAULT_BASE_URL = "https://booth.pm";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** BOOTH 会话凭证(兼容通用 PlatformCredentials)。 */
export interface BoothCredentials {
  /** 完整 cookie 字符串,如 "_pixiv_session=...; ..."。 */
  cookies: string;
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

/** 从 Set-Cookie 响应头提取 cookie 字符串(登录捕获时用)。 */
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

export interface BoothSessionOptions {
  cookie?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  authPath?: string;
}

/** 携带 cookie 的 BOOTH 请求会话。 */
export class BoothSession {
  readonly #baseUrl: string;
  readonly #fetchImpl: typeof fetch;
  readonly #authPath: string | undefined;
  #cookieMap: Record<string, string>;

  constructor(options: BoothSessionOptions = {}) {
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#authPath = options.authPath;

    // 显式 cookie 优先;否则从 AuthStore 加载(platform: "booth")。
    let cookie = options.cookie;
    if (cookie === undefined) {
      const store =
        options.authPath !== undefined
          ? new AuthStore({ platform: "booth", path: options.authPath })
          : new AuthStore({ platform: "booth" });
      const stored = store.loadSync();
      cookie = typeof stored?.credentials?.cookies === "string" ? stored.credentials.cookies : undefined;
    }
    this.#cookieMap = cookie !== undefined ? parseCookieString(cookie) : {};
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  /** 当前 cookie 字符串。 */
  get cookie(): string {
    return cookieStringify(this.#cookieMap);
  }

  /** 当前是否已登录(有会话 cookie)。 */
  get isLoggedIn(): boolean {
    return Object.keys(this.#cookieMap).length > 0;
  }

  /** 读取单个 cookie 值。 */
  cookieValue(name: string): string | undefined {
    return this.#cookieMap[name];
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

  /** 解析相对 URL 为绝对 URL(基于 baseUrl)。 */
  resolveUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return pathOrUrl;
    }
    return `${this.#baseUrl}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
  }

  /**
   * 发送请求,自动附加 Cookie 头与 User-Agent。
   * 响应非 2xx 时抛 BoothError(由 checkApiResponse 归类)。
   */
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = this.cookie;
    if (cookie !== "") {
      headers.set("Cookie", cookie);
    }
    headers.set("User-Agent", USER_AGENT);
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    }

    let response: Response;
    try {
      response = await this.#fetchImpl(this.resolveUrl(path), {
        ...init,
        headers,
        redirect: init.redirect ?? "manual",
      });
    } catch (error) {
      throw new BoothError(
        "NETWORK",
        error instanceof Error ? `network error: ${error.message}` : "network error",
      );
    }

    // 合并服务端 Set-Cookie(登录/会话续期)。
    this.mergeCookies(collectSetCookies(response.headers));
    return response;
  }

  /** 保存当前会话到 AuthStore(登录捕获后调用)。 */
  async persist(authPath?: string): Promise<void> {
    const resolved = authPath ?? this.#authPath;
    const store =
      resolved !== undefined
        ? new AuthStore({ platform: "booth", path: resolved })
        : new AuthStore({ platform: "booth" });
    const payload = {
      platform: "booth",
      credentials: { cookies: this.cookie } satisfies BoothCredentials,
      savedAt: new Date().toISOString(),
    };
    await store.save(payload);
  }

  /** 清除 AuthStore 中的登录态。 */
  async clear(authPath?: string): Promise<void> {
    const resolved = authPath ?? this.#authPath;
    const store =
      resolved !== undefined
        ? new AuthStore({ platform: "booth", path: resolved })
        : new AuthStore({ platform: "booth" });
    await store.clear();
  }
}
