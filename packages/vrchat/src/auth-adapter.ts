/**
 * VrchatPasswordAdapter —— 实现 account 的 PasswordLoginAdapter 契约。
 *
 * VRChat 认证协议(2026-08-23 实测 + 对照 VRCX 实现):
 * 1. GET /auth/user(Basic Auth,凭证 URL 编码后 base64)→ 成功返回用户对象 + Set-Cookie: auth=...
 *    (注意:官方登录是 GET 而非 POST;POST /auth/user 返回 405)
 * 2. 若账号开启 2FA,响应带 requiresTwoFactorAuth: ["emailOtp"|"totp"],未真正登录
 * 3. POST /auth/twofactorauth/{emailotp|totp}/verify,body { code } → 成功拿到最终 cookie
 * 4. GET /auth/user 检查会话;PUT /logout 登出
 *
 * 凭证只保存 cookie 字符串,不保存密码。
 */
import {
  AccountError,
  type PasswordLoginAdapter,
  type PasswordLoginStep,
  type PlatformCredentials,
} from "@sakurachiyo0v0/account";
import { VrchatHttpTransport } from "./transport.js";
import type { CurrentUser } from "./types.js";

export interface VrchatPasswordAdapterOptions {
  /** 传输层实例;登录成功后自动注入 cookie。 */
  transport: VrchatHttpTransport;
}

/** VRChat 密码登录适配器。 */
export class VrchatPasswordAdapter implements PasswordLoginAdapter {
  readonly platform = "vrchat";
  readonly #transport: VrchatHttpTransport;

  constructor(options: VrchatPasswordAdapterOptions) {
    this.#transport = options.transport;
  }

  async login(
    credentials: { username: string; password: string },
    _fetchImpl: typeof fetch,
  ): Promise<PasswordLoginStep> {
    // 官方要求凭证 URL 编码后再 base64(VRCX 同款实现)。
    const encoded = `${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}`;
    const basic = `Basic ${Buffer.from(encoded, "utf-8").toString("base64")}`;
    const response = await this.#request("/auth/user", {
      method: "GET",
      headers: {
        authorization: basic,
        accept: "application/json",
        "user-agent": this.#transport.userAgent,
      },
    });

    if (response.status === 401) {
      throw new AccountError("INVALID_CREDENTIALS", "用户名或密码错误");
    }
    if (response.status === 429) {
      throw new AccountError("AUTH_EXPIRED", "登录请求过于频繁,请稍后再试");
    }
    if (!response.ok) {
      throw new AccountError("API_ERROR", `登录失败(HTTP ${response.status})`);
    }

    const body = (await this.#safeJson(response)) as Partial<CurrentUser> | undefined;
    const twoFactor = Array.isArray(body?.requiresTwoFactorAuth)
      ? body!.requiresTwoFactorAuth!
      : [];

    if (twoFactor.length > 0) {
      // 2FA 中间会话:第一步响应已 Set-Cookie 中间 cookie,验证码请求必须携带
      //(否则第二步 POST verify 会 401"验证码错误")。VRCX 同款流程。
      const interimCookie = this.#extractAuthCookie(response);
      if (interimCookie !== undefined) {
        this.#transport.setCookie(interimCookie);
      }
      // 官方仅支持 emailOtp(邮箱验证码)与 totp(身份验证器)两类验证路径。
      const method = twoFactor[0] === "totp" ? "totp" : "emailOtp";
      return {
        status: "need_code",
        challengeId: method, // VRChat 的 2FA 验证不依赖 challengeId,以 method 占位
        method,
        message:
          method === "totp"
            ? "请输入身份验证器应用中的 6 位动态验证码"
            : "验证码已发送到你的邮箱,请输入",
      };
    }

    const cookie = this.#extractAuthCookie(response);
    if (cookie === undefined) {
      throw new AccountError("API_ERROR", "登录成功但服务端未返回会话 cookie");
    }
    this.#transport.setCookie(cookie);
    return { status: "success", credentials: { authCookie: cookie } };
  }

  async verifyCode(
    step: { challengeId: string; method: string },
    code: string,
    _fetchImpl: typeof fetch,
  ): Promise<PasswordLoginStep> {
    const endpoint =
      step.method === "totp"
        ? "/auth/twofactorauth/totp/verify"
        : "/auth/twofactorauth/emailotp/verify";
    const response = await this.#request(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": this.#transport.userAgent,
      },
      body: JSON.stringify({ code }),
    });

    if (response.status === 200) {
      // VRChat 2FA 流程:最终会话 cookie = 第一步的 auth= cookie(verify 响应只
      // Set-Cookie twoFactorAuth 票据,不能用作会话凭证)。保留第一步 cookie。
      const sessionCookie = this.#transport.cookie;
      if (sessionCookie === undefined) {
        // 兜底:若服务端在 verify 响应直接返回了真正的 auth cookie 则使用之
        const cookie = this.#extractAuthCookie(response);
        if (cookie === undefined) {
          throw new AccountError("API_ERROR", "2FA 验证成功但未持有会话 cookie");
        }
        this.#transport.setCookie(cookie);
        return { status: "success", credentials: { authCookie: cookie } };
      }
      return { status: "success", credentials: { authCookie: sessionCookie } };
    }

    // 401(或其它):验证码错误,允许重试
    return this.#needCodeAgain(step, "验证码错误,请重试");
  }

  serialize(credentials: PlatformCredentials, savedAt: string) {
    return { platform: this.platform, credentials, savedAt };
  }

  deserialize(payload: {
    platform: string;
    credentials: Record<string, unknown>;
    savedAt: string;
    expiresAt?: string;
  }): PlatformCredentials | null {
    const cookie = payload.credentials?.authCookie;
    return typeof cookie === "string" && cookie !== ""
      ? { authCookie: cookie }
      : null;
  }

  // ---- 内部 ----

  #needCodeAgain(
    step: { challengeId: string; method: string },
    message: string,
  ): PasswordLoginStep {
    return {
      status: "need_code",
      challengeId: step.challengeId,
      method: step.method,
      message,
    };
  }

  async #request(
    path: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      // 自动附带已保存的会话 cookie(2FA 中间 cookie / 已登录 cookie)。
      const cookie = this.#transport.cookie;
      const headers = {
        ...init.headers,
        ...(cookie !== undefined ? { cookie } : {}),
      };
      return await this.#transport.fetchImpl(this.#transport.baseUrl + path, {
        method: init.method,
        headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      const err = error as Error;
      if (err.name === "AbortError") {
        throw new AccountError("NETWORK", "登录请求超时", { cause: error });
      }
      throw new AccountError("NETWORK", "登录网络请求失败", { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async #safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  /** 从响应头提取 auth cookie。 */
  #extractAuthCookie(response: Response): string | undefined {
    const raw = response.headers.get("set-cookie");
    if (raw === null || raw === "") {
      return undefined;
    }
    // 精确匹配名为 auth 的 cookie(前面是分隔符/开头),避免误匹配
    // twoFactorAuth=... 中的 "auth="(VRChat 2FA verify 响应只发 twoFactorAuth 票据)。
    const authMatch = raw.match(/(?:^|[;\s,])auth=([^;,\s]+)/i);
    if (authMatch !== null) {
      return `auth=${authMatch[1]}`;
    }
    const first = raw.split(",")[0]?.split(";")[0]?.trim();
    return first !== undefined && first !== "" ? first : undefined;
  }
}
