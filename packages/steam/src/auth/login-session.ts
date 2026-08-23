/**
 * SteamLoginSession —— 自研 Steam 登录协议(JSON 版 IAuthenticationService,
 * 参考 MIT 协议 steam-session 的流程与字段,不用任何第三方登录依赖)。
 *
 * 流程:
 * 1. GetPasswordRSAPublicKey(GET)→ RSA(PKCS#1 v1.5)加密密码
 * 2. BeginAuthSessionViaCredentials / BeginAuthSessionViaQR → client_id/request_id/guard 列表
 * 3. UpdateAuthSessionWithSteamGuardCode(邮箱码=2 / TOTP=3)→ 或轮询设备确认
 * 4. PollAuthSessionStatus 轮询 → access_token + refresh_token
 * 5. finalizelogin(login.steampowered.com)拿 web cookie(steamLoginSecure/sessionid)
 * 6. GenerateAccessTokenForApp 续期
 */
import { randomBytes } from "node:crypto";
import type { SteamHttpTransport } from "../http.js";
import { SteamError, type SteamErrorCode } from "../errors.js";
import { SteamEndpoints, type SteamHost } from "../endpoints.js";
import { encryptPassword } from "./rsa.js";

/** Guard 类型(EAuthSessionGuardType 的常用子集)。 */
export type GuardType = "email" | "totp" | "device_confirmation";
/** 平台类型:1=SteamClient,2=WebBrowser,3=MobileApp。 */
export type PlatformType = 1 | 2 | 3;

export interface AllowedConfirmation {
  /** EAuthSessionGuardType:2=EmailCode,3=DeviceCode(TOTP),4=DeviceConfirmation,5=EmailConfirmation。 */
  type: number;
  message?: string;
}

/** IAuthenticationService 原始响应里的 guard 条目(snake_case)。 */
interface RawConfirmation {
  confirmation_type: number;
  associated_message?: string;
}

export interface AuthSessionState {
  clientId: string;
  requestId: string;
  /** Steam 建议的轮询间隔(秒)。 */
  interval: number;
  allowedConfirmations: AllowedConfirmation[];
  steamid?: string;
  weakToken?: string;
  challengeUrl?: string;
  version?: number;
}

export interface PollResult {
  status: "waiting" | "remote_interaction" | "success";
  accessToken?: string;
  refreshToken?: string;
  accountName?: string;
}

export interface SteamLoginSessionOptions {
  deviceFriendlyName?: string;
  platformType?: PlatformType;
}

export interface StartWithCredentialsOptions {
  accountName: string;
  password: string;
  /** 邮箱 Guard 机器令牌(可选,可跳过邮箱验证码)。 */
  machineToken?: string;
}

const GUARD_CODE: Record<GuardType, number> = {
  email: 2,
  totp: 3,
  device_confirmation: 4,
};

/** EResult → SteamErrorCode(只映射登录相关的常见错误)。 */
const ERESULT_MAP: Record<number, SteamErrorCode> = {
  5: "INVALID_CREDENTIALS", // InvalidPassword
  25: "TWO_FACTOR_FAILED", // InvalidLoginAuthCode
  63: "FORBIDDEN", // AccountDisabled
  66: "TWO_FACTOR_REQUIRED", // AccountLoginDeniedNeedTwoFactor
  84: "TWO_FACTOR_FAILED", // TwoFactorCodeMismatch
  86: "RATE_LIMIT", // RateLimitExceeded
};

/** 从 refresh_token JWT 解出 sub(steamid)。 */
export function decodeJwtPayload(jwt: string): { sub?: string } {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new SteamError("INVALID_CREDENTIALS", "无效的 refresh_token(JWT)");
  }
  try {
    const json = Buffer.from(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as { sub?: string };
  } catch {
    throw new SteamError("INVALID_CREDENTIALS", "无效的 refresh_token(JWT)");
  }
}

export class SteamLoginSession {
  readonly #transport: SteamHttpTransport;
  readonly #deviceFriendlyName: string;
  readonly #platformType: PlatformType;
  #state: AuthSessionState | undefined;

  constructor(transport: SteamHttpTransport, options: SteamLoginSessionOptions = {}) {
    this.#transport = transport;
    this.#deviceFriendlyName = options.deviceFriendlyName ?? "sakurachiyo0v0-ts-dev-kits";
    this.#platformType = options.platformType ?? 2; // WebBrowser → web audience 令牌
  }

  /** 当前会话状态。 */
  get state(): AuthSessionState | undefined {
    return this.#state;
  }

  /** 1. RSA 取公钥 + 2. 开始密码登录会话。 */
  async startWithCredentials(options: StartWithCredentialsOptions): Promise<AuthSessionState> {
    const rsa = await this.#authRequest<{
      response: { publickey_mod: string; publickey_exp: string; timestamp: string };
    }>({
      path: SteamEndpoints.auth.rsaKey,
      method: "GET",
      params: { account_name: options.accountName },
    });
    const encryptedPassword = encryptPassword(
      options.password,
      rsa.response.publickey_mod,
      rsa.response.publickey_exp,
    );
    const payload: Record<string, unknown> = {
      account_name: options.accountName,
      encrypted_password: encryptedPassword,
      encryption_timestamp: rsa.response.timestamp,
      remember_login: true,
      persistence: 1, // ESessionPersistence.Persistent
      website_id: "Community",
      device_details: {
        device_friendly_name: this.#deviceFriendlyName,
        platform_type: this.#platformType,
      },
      ...(options.machineToken !== undefined ? { guard_data: options.machineToken } : {}),
    };
    const result = await this.#authRequest<{
      response: {
        client_id: string;
        request_id: string;
        interval?: number;
        allowed_confirmations?: RawConfirmation[];
        steamid?: string;
        weak_token?: string;
      };
    }>({ path: SteamEndpoints.auth.beginCredentials, method: "POST", input_json: payload });
    this.#state = {
      clientId: result.response.client_id,
      requestId: result.response.request_id,
      interval: result.response.interval ?? 5,
      allowedConfirmations: (result.response.allowed_confirmations ?? []).map((c) => ({
        type: c.confirmation_type,
        ...(c.associated_message !== undefined ? { message: c.associated_message } : {}),
      })),
      ...(result.response.steamid !== undefined ? { steamid: result.response.steamid } : {}),
      ...(result.response.weak_token !== undefined ? { weakToken: result.response.weak_token } : {}),
    };
    return this.#state;
  }

  /** 开始二维码登录会话(challenge_url 为扫码内容)。 */
  async startWithQr(): Promise<AuthSessionState> {
    const result = await this.#authRequest<{
      response: {
        client_id: string;
        request_id: string;
        interval?: number;
        challenge_url: string;
        version?: number;
        allowed_confirmations?: RawConfirmation[];
      };
    }>({
      path: SteamEndpoints.auth.beginQr,
      method: "POST",
      input_json: {
        device_details: {
          device_friendly_name: this.#deviceFriendlyName,
          platform_type: this.#platformType,
        },
      },
    });
    this.#state = {
      clientId: result.response.client_id,
      requestId: result.response.request_id,
      interval: result.response.interval ?? 5,
      allowedConfirmations: (result.response.allowed_confirmations ?? []).map((c) => ({
        type: c.confirmation_type,
        ...(c.associated_message !== undefined ? { message: c.associated_message } : {}),
      })),
      challengeUrl: result.response.challenge_url,
      ...(result.response.version !== undefined ? { version: result.response.version } : {}),
    };
    return this.#state;
  }

  /** 提交 Steam Guard 验证码(邮箱码 / TOTP)。 */
  async submitSteamGuardCode(code: string, guard: GuardType): Promise<void> {
    const state = this.#requireState();
    await this.#authRequest<unknown>({
      path: SteamEndpoints.auth.updateGuardCode,
      method: "POST",
      input_json: {
        client_id: state.clientId,
        steamid: state.steamid,
        code,
        code_type: GUARD_CODE[guard],
      },
    });
  }

  /** 轮询登录状态(按 interval 调用)。 */
  async poll(): Promise<PollResult> {
    const state = this.#requireState();
    const result = await this.#authRequest<{
      response: {
        refresh_token?: string;
        access_token?: string;
        had_remote_interaction?: boolean;
        account_name?: string;
      };
    }>({
      path: SteamEndpoints.auth.pollStatus,
      method: "POST",
      input_json: { client_id: state.clientId, request_id: state.requestId },
    });
    const r = result.response;
    if (r.refresh_token !== undefined && r.access_token !== undefined) {
      return {
        status: "success",
        accessToken: r.access_token,
        refreshToken: r.refresh_token,
        ...(r.account_name !== undefined ? { accountName: r.account_name } : {}),
      };
    }
    if (r.had_remote_interaction === true) {
      return { status: "remote_interaction" };
    }
    return { status: "waiting" };
  }

  /**
   * 用 refresh_token 拿 web cookie(steamLoginSecure 等,逗号分号拼接串)。
   * 流程:finalizelogin → transfer_info 逐个 POST setcookie → 收集 + sessionid。
   */
  async getWebCookies(refreshToken: string, steamid64: string): Promise<string> {
    const sessionId = randomBytes(12).toString("hex");
    const finalize = await this.#transport.requestRaw<{
      error?: number;
      transfer_info?: Array<{ url: string; params: Record<string, string> }>;
    }>({
      host: "login",
      path: SteamEndpoints.login.finalizeLogin,
      method: "POST",
      form: {
        nonce: refreshToken,
        sessionid: sessionId,
        redir: "https://steamcommunity.com/login/home/?goto=",
      },
      headers: { origin: "https://steamcommunity.com", referer: "https://steamcommunity.com/" },
      noCache: true,
    });
    if (finalize.status >= 400 || finalize.body.error !== undefined) {
      throw new SteamError("AUTH_EXPIRED", "最终化登录失败(refresh_token 无效或已过期)");
    }
    const transferInfo = finalize.body.transfer_info ?? [];
    if (transferInfo.length === 0) {
      throw new SteamError("AUTH_EXPIRED", "最终化登录响应缺少 transfer_info");
    }

    const cookies: string[] = [];
    for (const transfer of transferInfo) {
      const url = new URL(transfer.url);
      const host = this.#hostForUrl(url);
      const response = await this.#transport.requestRaw<{ result?: number }>({
        host,
        path: url.pathname,
        method: "POST",
        form: { steamID: steamid64, ...transfer.params },
        noCache: true,
      });
      if (response.status >= 400 || (response.body?.result !== undefined && response.body.result !== 1)) {
        continue; // 单个 transfer 失败不阻断整体
      }
      const setCookies = this.#extractSetCookies(response.headers);
      for (const raw of setCookies) {
        cookies.push(this.#ensureDomain(raw, url.host));
      }
    }

    // 过滤 sessionid(统一由我们补一份覆盖所有域),并为每个域追加 sessionid。
    const sessionCookie = cookies.filter((c) => !c.startsWith("sessionid="));
    const domains = new Set<string>();
    for (const cookie of sessionCookie) {
      const domain = cookie.split("Domain=")[1]?.split(";")[0];
      if (domain !== undefined && domain !== "login.steampowered.com") {
        domains.add(domain);
      }
    }
    for (const domain of domains) {
      sessionCookie.push(`sessionid=${sessionId}; Path=/; Secure; SameSite=None; Domain=${domain}`);
    }
    return sessionCookie.join("; ");
  }

  /** 用 refresh_token 换新 access_token(可选续期 refresh_token)。 */
  async generateAccessToken(
    refreshToken: string,
    renew = false,
  ): Promise<{ accessToken: string; refreshToken?: string }> {
    const steamid = decodeJwtPayload(refreshToken).sub;
    if (steamid === undefined) {
      throw new SteamError("INVALID_CREDENTIALS", "refresh_token 缺少 sub(steamid)");
    }
    const result = await this.#authRequest<{
      response: { access_token: string; refresh_token?: string };
    }>({
      path: SteamEndpoints.auth.generateToken,
      method: "POST",
      input_json: {
        refresh_token: refreshToken,
        steamid,
        renewal_type: renew ? 1 : 0, // ETokenRenewalType.Allow / None
      },
    });
    return {
      accessToken: result.response.access_token,
      ...(result.response.refresh_token !== undefined ? { refreshToken: result.response.refresh_token } : {}),
    };
  }

  #requireState(): AuthSessionState {
    if (this.#state === undefined) {
      throw new SteamError("CONFIGURATION", "登录会话尚未开始");
    }
    return this.#state;
  }

  /** IAuthenticationService JSON 请求:form input_json + x-eresult 头解析。 */
  async #authRequest<T>(request: {
    path: string;
    method: "GET" | "POST";
    params?: Record<string, string | number | undefined>;
    input_json?: Record<string, unknown>;
  }): Promise<T> {
    const result = await this.#transport.requestRaw<T>({
      host: "api",
      path: request.path,
      method: request.method,
      ...(request.params !== undefined ? { params: request.params } : {}),
      ...(request.input_json !== undefined
        ? { form: { input_json: JSON.stringify(request.input_json) } }
        : {}),
      noCache: true,
    });
    const eresultHeader = result.headers.get("x-eresult");
    if (eresultHeader !== null && eresultHeader !== "" && Number(eresultHeader) !== 1) {
      throw this.#eresultError(Number(eresultHeader));
    }
    if (result.status >= 400) {
      const body = result.body as { error?: number | string } | undefined;
      if (body !== undefined && typeof body.error === "number") {
        throw this.#eresultError(body.error);
      }
      throw new SteamError("UNKNOWN", `认证接口错误(HTTP ${result.status})`, {
        statusCode: result.status,
      });
    }
    return result.body;
  }

  #eresultError(eresult: number): SteamError {
    const code = ERESULT_MAP[eresult] ?? "UNKNOWN";
    const message: Record<number, string> = {
      5: "用户名或密码错误",
      25: "Steam Guard 验证码错误",
      63: "账号已被 Steam 禁用",
      66: "需要 Steam Guard 验证(请在手机或邮箱确认)",
      84: "两步验证码不匹配",
      86: "登录请求过于频繁,请稍后再试",
    };
    return new SteamError(code, message[eresult] ?? `Steam 登录失败(EResult ${eresult})`);
  }

  #hostForUrl(url: URL): SteamHost {
    const host = url.host;
    if (host === "store.steampowered.com") return "store";
    if (host === "steamcommunity.com") return "community";
    if (host === "api.steampowered.com") return "api";
    return "login";
  }

  #extractSetCookies(headers: Headers): string[] {
    const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof getSetCookie === "function") {
      return getSetCookie.call(headers);
    }
    const value = headers.get("set-cookie");
    return value !== null && value !== "" ? [value] : [];
  }

  #ensureDomain(cookie: string, host: string): string {
    return cookie.toLowerCase().includes("domain=") ? cookie : `${cookie}; Domain=${host}`;
  }
}
