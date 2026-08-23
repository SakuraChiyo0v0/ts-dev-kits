/**
 * AuthApi —— client.auth:登录态管理(密码+Guard / QR / cookie 导入 / 续期 / 登出)。
 * 复用 @sakurachiyo0v0/account 的登录骨架与 AuthStore 持久化。
 */
import {
  AuthStore,
  passwordLogin,
  qrcodeLogin,
  type LoginResult,
  type LoginStatus,
} from "@sakurachiyo0v0/account";
import type { SteamHttpTransport } from "../http.js";
import { SteamError } from "../errors.js";
import { SteamLoginSession } from "./login-session.js";
import {
  SteamPasswordAdapter,
  SteamQrAdapter,
  deserializeSteamCredentials,
  serializeSteamCredentials,
  type SteamAdapterOptions,
  type SteamSessionCredentials,
} from "./adapters.js";
import { generateTotpCode } from "./totp.js";
import type { SteamLoginSessionOptions } from "./login-session.js";

export interface AuthApiOptions {
  /** 登录态存储;不传则不持久化。 */
  store?: AuthStore;
  deviceFriendlyName?: string;
}

export interface SteamPasswordLoginOptions {
  accountName: string;
  password: string;
  /** 需要验证码时的回调(返回空字符串取消)。 */
  onNeedCode?: (info: { method: string; message: string; attempt: number }) => Promise<string> | string;
  /** 提供 Steam 手机令牌 shared_secret 时自动填充 TOTP 验证码。 */
  totpSharedSecret?: string;
  /** 覆盖默认存储。 */
  store?: AuthStore;
  onStatus?: (status: { state: string; message: string }) => void;
}

export interface SteamQrLoginOptions {
  /** 是否自动打开浏览器(显示二维码页面),默认 false。 */
  autoOpenBrowser?: boolean;
  onStatus?: (status: LoginStatus) => void;
  /** 覆盖默认存储。 */
  store?: AuthStore;
  /** 轮询间隔(毫秒),默认 2000。 */
  pollIntervalMs?: number;
  /** 总超时(毫秒),默认 180000。 */
  timeoutMs?: number;
}

export interface SteamSessionStatus {
  loggedIn: boolean;
  accountName?: string;
  steamid?: string;
}

export class AuthApi {
  readonly #transport: SteamHttpTransport;
  readonly #store: AuthStore | undefined;
  readonly #deviceFriendlyName: string | undefined;

  constructor(transport: SteamHttpTransport, options: AuthApiOptions = {}) {
    this.#transport = transport;
    this.#store = options.store;
    this.#deviceFriendlyName = options.deviceFriendlyName;
    // 从持久化会话回填传输层 cookie:新客户端实例(如 CLI 每次调用)复用登录态。
    // 显式传入的 options.cookie 优先,不覆盖。
    const credentials = this.#loadCredentials();
    if (credentials?.cookies !== undefined && this.#transport.cookie === undefined) {
      this.#transport.setCookie(credentials.cookies);
    }
  }

  /** 当前登录态存储(可能为 undefined)。 */
  get store(): AuthStore | undefined {
    return this.#store;
  }

  /** 密码登录(自动处理邮箱码 / TOTP / 设备确认)。 */
  async loginWithPassword(options: SteamPasswordLoginOptions): Promise<LoginResult> {
    const adapter = new SteamPasswordAdapter(this.#adapterOptions());
    const onNeedCode = this.#withTotpAutoFill(options);
    return passwordLogin({
      adapter,
      username: options.accountName,
      password: options.password,
      ...(onNeedCode !== undefined ? { onNeedCode } : {}),
      ...(options.store !== undefined
        ? { store: options.store }
        : this.#store !== undefined
          ? { store: this.#store }
          : {}),
      ...(options.onStatus !== undefined ? { onStatus: options.onStatus } : {}),
    });
  }

  /** 二维码登录(Steam 手机 App 扫码)。 */
  async loginWithQr(options: SteamQrLoginOptions = {}): Promise<LoginResult> {
    const adapter = new SteamQrAdapter(this.#adapterOptions());
    return qrcodeLogin({
      adapter,
      ...(options.store !== undefined
        ? { store: options.store }
        : this.#store !== undefined
          ? { store: this.#store }
          : {}),
      autoOpenBrowser: options.autoOpenBrowser ?? false,
      ...(options.onStatus !== undefined ? { onStatus: options.onStatus } : {}),
      ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  /** 导入已有 web cookie(如浏览器复制的 steamLoginSecure 串),可选持久化。 */
  async importCookies(cookieString: string, options: { save?: boolean } = {}): Promise<void> {
    if (cookieString.trim() === "") {
      throw new SteamError("INVALID_CREDENTIALS", "cookie 为空");
    }
    this.#transport.setCookie(cookieString);
    if (options.save !== false && this.#store !== undefined) {
      await this.#store.save(serializeSteamCredentials({ cookies: cookieString }, new Date().toISOString()));
    }
  }

  /** 当前会话状态(基于本地存储,不发起网络)。 */
  status(): SteamSessionStatus {
    const credentials = this.#loadCredentials();
    const hasTokens =
      credentials?.refreshToken !== undefined || credentials?.accessToken !== undefined;
    const hasCookies = credentials?.cookies !== undefined || this.#transport.cookie !== undefined;
    return {
      loggedIn: hasTokens || hasCookies,
      ...(credentials?.accountName !== undefined ? { accountName: credentials.accountName } : {}),
      ...(credentials?.steamid !== undefined ? { steamid: credentials.steamid } : {}),
    };
  }

  /** 校验会话:有 refresh_token 则实际续期验证;仅 cookie 时本地判断。 */
  async checkSession(): Promise<boolean> {
    const credentials = this.#loadCredentials();
    if (credentials?.refreshToken !== undefined) {
      try {
        const session = new SteamLoginSession(this.#transport, this.#sessionOptions());
        const result = await session.generateAccessToken(credentials.refreshToken, false);
        await this.#save({ ...credentials, accessToken: result.accessToken });
        return true;
      } catch {
        return false;
      }
    }
    return credentials?.cookies !== undefined || this.#transport.cookie !== undefined;
  }

  /** 用 refresh_token 重新拉取 web cookie(community 登录态恢复/续期)。 */
  async refreshCookies(): Promise<string> {
    const credentials = this.#loadCredentials();
    if (credentials?.refreshToken === undefined || credentials?.steamid === undefined) {
      throw new SteamError("LOGIN_REQUIRED", "缺少 refresh_token/steamid,无法刷新 web cookie");
    }
    const session = new SteamLoginSession(this.#transport, this.#sessionOptions());
    const cookies = await session.getWebCookies(credentials.refreshToken, credentials.steamid);
    this.#transport.setCookie(cookies);
    await this.#save({ ...credentials, cookies });
    return cookies;
  }

  /** 登出:清除传输层 cookie 与持久化登录态。 */
  async logout(): Promise<void> {
    this.#transport.clearCookie();
    if (this.#store !== undefined) {
      await this.#store.clear();
    }
  }

  #adapterOptions(): SteamAdapterOptions {
    return {
      transport: this.#transport,
      ...(this.#deviceFriendlyName !== undefined ? { deviceFriendlyName: this.#deviceFriendlyName } : {}),
    };
  }

  #sessionOptions(): SteamLoginSessionOptions {
    return {
      ...(this.#deviceFriendlyName !== undefined ? { deviceFriendlyName: this.#deviceFriendlyName } : {}),
    };
  }

  #withTotpAutoFill(
    options: SteamPasswordLoginOptions,
  ): SteamPasswordLoginOptions["onNeedCode"] {
    if (options.onNeedCode !== undefined) {
      return options.onNeedCode;
    }
    if (options.totpSharedSecret === undefined) {
      return undefined;
    }
    return async (info) => {
      if (info.method === "totp") {
        return generateTotpCode(options.totpSharedSecret!);
      }
      throw new SteamError("TWO_FACTOR_REQUIRED", "需要邮箱验证码,但未提供 onNeedCode 回调");
    };
  }

  #loadCredentials(): SteamSessionCredentials | null {
    if (this.#store === undefined) {
      return this.#transport.cookie !== undefined ? { cookies: this.#transport.cookie } : null;
    }
    const payload = this.#store.loadSync();
    if (payload === null) {
      return null;
    }
    return deserializeSteamCredentials(payload);
  }

  async #save(credentials: SteamSessionCredentials): Promise<void> {
    if (this.#store !== undefined) {
      await this.#store.save(serializeSteamCredentials(credentials, new Date().toISOString()));
    }
  }
}
