/**
 * BoothBrowserAdapter —— 实现 account 的 BrowserLoginAdapter 契约。
 * BOOTH 无公开登录 API,登录态只能靠浏览器会话 cookie:
 *  - 登录页:https://booth.pm/users/sign_in(Pixiv 账号)
 *  - 会话特征:_pixiv_session / pixiv_session(Pixiv 系)或 __csrf_token
 *  - 校验:请求用户订单页(accounts.booth.pm/orders),确认未被重定向到登录页
 * 凭证序列化格式与既有 auth.json 一致({ platform: "booth", credentials: { cookies } }),兼容旧登录态。
 */
import {
  AccountError,
  type AuthPayload,
  type BrowserLoginAdapter,
  type PlatformCredentials,
} from "@sakurachiyo0v0/account";
import { BoothSession } from "./session.js";

/** 会话特征 cookie 域(BOOTH 与 Pixiv 域;CDP 只收集这些域)。 */
export const BOOTH_COOKIE_DOMAINS = ["booth.pm", "pixiv.net"] as const;

/** 出现任一即视为登录成功的会话 cookie 名。 */
export const BOOTH_SESSION_COOKIE_NAMES = [
  "_pixiv_session",
  "pixiv_session",
  "__csrf_token",
] as const;

/** 登录后校验用的用户订单页(登录态特征页)。 */
export const BOOTH_VALIDATE_URL = "https://accounts.booth.pm/orders";

/** BOOTH 浏览器登录适配器。 */
export function boothBrowserAdapter(): BrowserLoginAdapter {
  return {
    platform: "booth",
    loginUrl: "https://booth.pm/users/sign_in",
    cookieDomains: [...BOOTH_COOKIE_DOMAINS],
    sessionCookieNames: [...BOOTH_SESSION_COOKIE_NAMES],

    async validate(cookieHeader: string, fetchImpl: typeof fetch): Promise<void> {
      // 复用 BoothSession 的请求语义(UA + Cookie 头 + redirect manual),与捕获路径一致。
      const session = new BoothSession({ cookie: cookieHeader, fetchImpl });
      const check = await session.request(BOOTH_VALIDATE_URL, { method: "GET" });
      if (check.status === 200) {
        const html = await check.text();
        if (/login/i.test(html.slice(0, 500))) {
          throw new AccountError(
            "AUTH_EXPIRED",
            "captured session is not valid (redirected to login)",
          );
        }
        return;
      }
      throw new AccountError(
        "AUTH_EXPIRED",
        `session validation failed with HTTP ${check.status}`,
      );
    },

    serialize(credentials: PlatformCredentials, savedAt: string): AuthPayload {
      const cookieHeader = String(
        (credentials as { cookieHeader?: unknown }).cookieHeader ?? "",
      );
      return {
        platform: "booth",
        credentials: { cookies: cookieHeader },
        savedAt,
      };
    },

    deserialize(payload: AuthPayload): PlatformCredentials | null {
      const cookies = payload.credentials?.cookies;
      return typeof cookies === "string" && cookies !== ""
        ? { cookieHeader: cookies }
        : null;
    },
  };
}
