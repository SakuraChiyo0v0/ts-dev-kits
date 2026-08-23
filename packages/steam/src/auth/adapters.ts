/**
 * Steam 登录适配器 —— 实现 account 的 PasswordLoginAdapter / QrLoginAdapter 契约。
 * 复用 @sakurachiyo0v0/account 的登录骨架(passwordLogin / qrcodeLogin / AuthStore),
 * Steam 协议细节全部收敛在 SteamLoginSession。
 */
import {
  AccountError,
  type AuthPayload,
  type PasswordLoginAdapter,
  type PasswordLoginStep,
  type PlatformCredentials,
  type QrLoginAdapter,
} from "@sakurachiyo0v0/account";
import type { SteamHttpTransport } from "../http.js";
import { SteamError } from "../errors.js";
import {
  SteamLoginSession,
  decodeJwtPayload,
  type AuthSessionState,
  type GuardType,
} from "./login-session.js";

/** Steam 会话凭证(存 AuthStore / 返回给调用方)。type 别名以获得隐式索引签名,兼容 PlatformCredentials。 */
export type SteamSessionCredentials = {
  accountName?: string;
  steamid?: string;
  accessToken?: string;
  refreshToken?: string;
  /** web cookie(steamLoginSecure/sessionid 拼接串);community 登录态用。 */
  cookies?: string;
};

export interface SteamAdapterOptions {
  transport: SteamHttpTransport;
  deviceFriendlyName?: string;
  /** 无验证码路径(设备确认)时轮询等待上限,默认 120 秒。 */
  pollTimeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 从 allowed_confirmations 选验证路径:优先 TOTP,其次邮箱码,再设备确认。 */
export function pickGuard(confirmations: Array<{ type: number }>): GuardType | undefined {
  const types = confirmations.map((c) => c.type);
  if (types.includes(3)) return "totp";
  if (types.includes(2)) return "email";
  if (types.includes(4) || types.includes(5)) return "device_confirmation";
  return undefined;
}

/** 凭证序列化(与 deserializeSteamCredentials 成对)。 */
export function serializeSteamCredentials(
  credentials: SteamSessionCredentials,
  savedAt: string,
): AuthPayload {
  return { platform: "steam", credentials, savedAt };
}

/** 从 AuthPayload 反序列化;无令牌也无 cookie 视为无效。 */
export function deserializeSteamCredentials(
  payload: AuthPayload,
): SteamSessionCredentials | null {
  const c = payload.credentials ?? {};
  const hasToken =
    typeof c.refreshToken === "string" && c.refreshToken !== "" ? "refreshToken" : undefined;
  const hasCookie = typeof c.cookies === "string" && c.cookies !== "" ? "cookies" : undefined;
  if (hasToken === undefined && hasCookie === undefined) {
    return null;
  }
  const result: SteamSessionCredentials = {};
  for (const key of ["accountName", "steamid", "accessToken", "refreshToken", "cookies"] as const) {
    const value = c[key];
    if (typeof value === "string" && value !== "") {
      result[key] = value;
    }
  }
  return result;
}

/** 把 SteamError 映射为 account 的 AccountError(适配器只抛 AccountError)。 */
function toAccountError(error: unknown): AccountError {
  if (error instanceof AccountError) {
    return error;
  }
  if (error instanceof SteamError) {
    switch (error.code) {
      case "INVALID_CREDENTIALS":
        return new AccountError("INVALID_CREDENTIALS", error.message);
      case "TWO_FACTOR_FAILED":
        return new AccountError("TWO_FACTOR_FAILED", error.message);
      case "TWO_FACTOR_REQUIRED":
        return new AccountError("TWO_FACTOR_REQUIRED", error.message);
      case "RATE_LIMIT":
        return new AccountError("AUTH_EXPIRED", "登录请求过于频繁,请稍后再试");
      case "TIMEOUT":
        return new AccountError("NETWORK", error.message);
      default:
        return new AccountError("API_ERROR", error.message);
    }
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return new AccountError("API_ERROR", message);
}

/** Steam 密码登录适配器。 */
export class SteamPasswordAdapter implements PasswordLoginAdapter {
  readonly platform = "steam";
  readonly #options: SteamAdapterOptions;
  #session: SteamLoginSession | undefined;
  #state: AuthSessionState | undefined;
  #guard: GuardType | undefined;

  constructor(options: SteamAdapterOptions) {
    this.#options = options;
  }

  async login(
    credentials: { username: string; password: string },
    _fetchImpl: typeof fetch,
  ): Promise<PasswordLoginStep> {
    const session = new SteamLoginSession(this.#options.transport, {
      ...(this.#options.deviceFriendlyName !== undefined
        ? { deviceFriendlyName: this.#options.deviceFriendlyName }
        : {}),
    });
    this.#session = session;
    try {
      const state = await session.startWithCredentials({
        accountName: credentials.username,
        password: credentials.password,
      });
      this.#state = state;
    } catch (error) {
      throw toAccountError(error);
    }

    const guard = pickGuard(this.#state.allowedConfirmations);
    if (guard === "email" || guard === "totp") {
      this.#guard = guard;
      return {
        status: "need_code",
        challengeId: this.#state.clientId,
        method: guard === "totp" ? "totp" : "otp",
        message:
          guard === "totp"
            ? "请输入 Steam 手机令牌中的 5 位动态验证码"
            : "验证码已发送到你的邮箱,请输入",
      };
    }
    // 无 Guard / 设备确认(扫码后手机确认):直接轮询到成功。
    this.#guard = undefined;
    const credentialsResult = await this.#pollUntilSuccess();
    return { status: "success", credentials: credentialsResult };
  }

  async verifyCode(
    step: { challengeId: string; method: string },
    code: string,
    _fetchImpl: typeof fetch,
  ): Promise<PasswordLoginStep> {
    const guard: GuardType =
      this.#guard ?? (step.method === "totp" ? "totp" : "email");
    try {
      await this.#requireSession().submitSteamGuardCode(code, guard);
      const credentialsResult = await this.#pollUntilSuccess();
      return { status: "success", credentials: credentialsResult };
    } catch (error) {
      const guardCodeFailed =
        (error instanceof AccountError && error.code === "TWO_FACTOR_FAILED") ||
        (error instanceof SteamError && error.code === "TWO_FACTOR_FAILED");
      if (guardCodeFailed) {
        // 验证码错误:允许骨架重试。
        return {
          status: "need_code",
          challengeId: step.challengeId,
          method: step.method,
          message: "验证码错误,请重试",
        };
      }
      throw error;
    }
  }

  serialize(credentials: PlatformCredentials, savedAt: string): AuthPayload {
    return serializeSteamCredentials(credentials as SteamSessionCredentials, savedAt);
  }

  deserialize(payload: AuthPayload): PlatformCredentials | null {
    return deserializeSteamCredentials(payload);
  }

  async #pollUntilSuccess(): Promise<SteamSessionCredentials> {
    const session = this.#requireSession();
    const state = this.#requireState();
    const intervalMs = Math.max(state.interval, 1) * 1000;
    const deadline = Date.now() + (this.#options.pollTimeoutMs ?? 120_000);
    let accessToken: string | undefined;
    let refreshToken: string | undefined;
    let accountName: string | undefined;
    for (;;) {
      let result;
      try {
        result = await session.poll();
      } catch (error) {
        throw toAccountError(error);
      }
      if (result.status === "success") {
        accessToken = result.accessToken;
        refreshToken = result.refreshToken;
        accountName = result.accountName;
        break;
      }
      if (Date.now() >= deadline) {
        throw new AccountError("LOGIN_REQUIRED", "等待 Steam 确认超时,请重试");
      }
      await sleep(intervalMs);
    }
    return this.#finalize(accountName, accessToken!, refreshToken!);
  }

  async #finalize(
    accountName: string | undefined,
    accessToken: string,
    refreshToken: string,
  ): Promise<SteamSessionCredentials> {
    const state = this.#requireState();
    let cookies: string | undefined;
    if (state.steamid !== undefined) {
      try {
        cookies = await this.#requireSession().getWebCookies(refreshToken, state.steamid);
        this.#options.transport.setCookie(cookies);
      } catch {
        // finalizelogin 失败不阻断登录(api 能力仍可用,community 需 cookies 的能力受影响)。
      }
    }
    return {
      ...(accountName !== undefined ? { accountName } : {}),
      ...(state.steamid !== undefined ? { steamid: state.steamid } : {}),
      accessToken,
      refreshToken,
      ...(cookies !== undefined ? { cookies } : {}),
    };
  }

  #requireSession(): SteamLoginSession {
    if (this.#session === undefined) {
      throw new AccountError("API_ERROR", "登录会话未初始化");
    }
    return this.#session;
  }

  #requireState(): AuthSessionState {
    if (this.#state === undefined) {
      throw new AccountError("API_ERROR", "登录会话未初始化");
    }
    return this.#state;
  }
}

/** Steam 二维码登录适配器(扫码内容为 challenge_url,需 Steam 手机 App)。 */
export class SteamQrAdapter implements QrLoginAdapter {
  readonly platform = "steam";
  readonly #options: SteamAdapterOptions;
  #session: SteamLoginSession | undefined;
  #state: AuthSessionState | undefined;

  constructor(options: SteamAdapterOptions) {
    this.#options = options;
  }

  async generateKey(_fetchImpl: typeof fetch): Promise<{ key: string; url: string }> {
    const session = new SteamLoginSession(this.#options.transport, {
      ...(this.#options.deviceFriendlyName !== undefined
        ? { deviceFriendlyName: this.#options.deviceFriendlyName }
        : {}),
    });
    try {
      const state = await session.startWithQr();
      this.#session = session;
      this.#state = state;
      if (state.challengeUrl === undefined) {
        throw new AccountError("API_ERROR", "Steam 未返回二维码链接");
      }
      return {
        key: JSON.stringify({ clientId: state.clientId, requestId: state.requestId }),
        url: state.challengeUrl,
      };
    } catch (error) {
      throw toAccountError(error);
    }
  }

  async pollStatus(
    key: string,
    _fetchImpl: typeof fetch,
  ): Promise<{
    state: "waiting" | "scanned" | "success" | "expired";
    message: string;
    credentials?: SteamSessionCredentials;
  }> {
    let parsed: { clientId?: string; requestId?: string };
    try {
      parsed = JSON.parse(key) as { clientId?: string; requestId?: string };
    } catch {
      return { state: "expired", message: "二维码会话无效" };
    }
    void parsed;
    const session = this.#session;
    if (session === undefined) {
      return { state: "expired", message: "二维码会话不存在" };
    }
    let result;
    try {
      result = await session.poll();
    } catch {
      return { state: "expired", message: "二维码已过期,正在重新生成" };
    }
    if (result.status === "success") {
      const credentials = await this.#finalize(result.accountName, result.accessToken!, result.refreshToken!);
      return { state: "success", message: "登录成功", credentials };
    }
    if (result.status === "remote_interaction") {
      return { state: "scanned", message: "已扫码,请在 Steam 手机 App 上确认" };
    }
    return { state: "waiting", message: "等待扫码..." };
  }

  serialize(credentials: PlatformCredentials, savedAt: string): AuthPayload {
    return serializeSteamCredentials(credentials as SteamSessionCredentials, savedAt);
  }

  deserialize(payload: AuthPayload): PlatformCredentials | null {
    return deserializeSteamCredentials(payload);
  }

  async #finalize(
    accountName: string | undefined,
    accessToken: string,
    refreshToken: string,
  ): Promise<SteamSessionCredentials> {
    const state = this.#state;
    // 二维码会话响应不含 steamid;从 refresh_token JWT 的 sub 推导。
    let steamid = state?.steamid;
    if (steamid === undefined) {
      try {
        steamid = decodeJwtPayload(refreshToken).sub;
      } catch {
        steamid = undefined;
      }
    }
    let cookies: string | undefined;
    if (steamid !== undefined) {
      try {
        cookies = await this.#session!.getWebCookies(refreshToken, steamid);
        this.#options.transport.setCookie(cookies);
      } catch {
        // 同上:web cookie 失败不阻断。
      }
    }
    return {
      ...(accountName !== undefined ? { accountName } : {}),
      ...(steamid !== undefined ? { steamid } : {}),
      accessToken,
      refreshToken,
      ...(cookies !== undefined ? { cookies } : {}),
    };
  }
}
