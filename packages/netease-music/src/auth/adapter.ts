/**
 * 网易云二维码登录适配器(QrLoginAdapter 实现)。
 *
 * 协议(weapi 加密):
 *   1. POST /weapi/login/qr/unikey { type: 1 } → { data: { unikey } }
 *   2. 扫码 URL:https://music.163.com/login?codekey=<unikey>
 *   3. 轮询 POST /weapi/login/qr/check { unikey, type: 1 }:
 *      - 800 二维码过期(重新生成)/ 801 等待扫码 / 802 已扫待确认 / 803 登录成功
 *      - 803 时响应 Set-Cookie 含 MUSIC_U(核心登录态)、__csrf 等
 *
 * 凭证:收集 Set-Cookie 中的 MUSIC_U / __csrf / NMTID 等,存为 cookies 字符串。
 */
import type { QrLoginAdapter } from "@sakurachiyo0v0/account";
import type { AuthPayload } from "@sakurachiyo0v0/account";
import { NeteaseError } from "../errors.js";
import {
  collectSetCookies,
  cookieStringify,
  parseCookieString,
  WeapiSession,
  type NeteaseCredentials,
} from "../api/session.js";

const LOGIN_UNIKEY_PATH = "/weapi/login/qrcode/unikey";
const LOGIN_CHECK_PATH = "/weapi/login/qrcode/client/login";

/** 扫码状态码。 */
const QR_EXPIRED = 800;
const QR_WAITING = 801;
const QR_SCANNED = 802;
const QR_SUCCESS = 803;

/** 网易云二维码登录适配器。 */
export function neteaseQrAdapter(options: {
  baseUrl?: string;
  /** 匿名会话需要的初始 cookie(可选,一般不需要)。 */
  cookie?: string;
} = {}): QrLoginAdapter {
  return {
    platform: "netease-music",

    async generateKey(fetchImpl) {
      const session = new WeapiSession({
        ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
        fetchImpl,
        ...(options.cookie !== undefined ? { cookie: options.cookie } : {}),
      });
      const body = await session.post(LOGIN_UNIKEY_PATH, { type: 3 });
      // 响应形如 {"code":200,"unikey":"..."} —— unikey 在顶层。
      const unikey =
        typeof body.unikey === "string"
          ? body.unikey
          : typeof (body.data as Record<string, unknown> | undefined)?.unikey === "string"
            ? String((body.data as Record<string, unknown>).unikey)
            : "";
      if (unikey === "") {
        throw new NeteaseError("API_ERROR", "login/qr/unikey response missing unikey", {
          cause: body,
        });
      }
      const url = `https://music.163.com/login?codekey=${encodeURIComponent(unikey)}`;
      return { key: unikey, url };
    },

    async pollStatus(key, fetchImpl) {
      const session = new WeapiSession({
        ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
        fetchImpl,
        ...(options.cookie !== undefined ? { cookie: options.cookie } : {}),
      });
      const { body, response } = await session.postRaw(LOGIN_CHECK_PATH, {
        key,
        type: 3,
      });
      const code = Number(body.code ?? -1);
      const message = String(body.message ?? "");
      if (code === QR_SUCCESS) {
        const setCookies = collectSetCookies(response.headers);
        const cookies = cookieStringify(setCookies);
        if (cookies === "" || setCookies.MUSIC_U === undefined) {
          throw new NeteaseError("API_ERROR", "登录成功但响应缺少 MUSIC_U cookie", {
            cause: body,
          });
        }
        const credentials: NeteaseCredentials = {
          cookies,
          ...(setCookies.__csrf !== undefined ? { csrf: setCookies.__csrf } : {}),
        };
        return { state: "success", message: "登录成功", credentials };
      }
      if (code === QR_EXPIRED) {
        return { state: "expired", message: "二维码已过期" };
      }
      if (code === QR_SCANNED) {
        return { state: "scanned", message: "已扫码,请在手机上确认" };
      }
      if (code === QR_WAITING) {
        return { state: "waiting", message: "等待扫码" };
      }
      return { state: "waiting", message: `等待扫码(${code})` };
    },

    serialize(credentials, savedAt) {
      const payload: AuthPayload = {
        platform: "netease-music",
        credentials: {
          cookies: String(credentials.cookies ?? ""),
          ...(typeof credentials.csrf === "string" ? { csrf: credentials.csrf } : {}),
          ...(typeof credentials.userId === "string" ? { userId: credentials.userId } : {}),
        },
        savedAt,
      };
      return payload;
    },

    deserialize(payload) {
      if (payload.platform !== "netease-music") {
        return null;
      }
      const cred = payload.credentials as Partial<NeteaseCredentials>;
      if (typeof cred.cookies !== "string" || cred.cookies === "") {
        return null;
      }
      return {
        cookies: cred.cookies,
        ...(typeof cred.csrf === "string" ? { csrf: cred.csrf } : {}),
        ...(typeof cred.userId === "string" ? { userId: cred.userId } : {}),
      };
    },
  };
}

/** 从 cookie 对象中提取 MUSIC_U 等关键字段。 */
export function extractCoreCookies(cookies: string): NeteaseCredentials {
  const parsed = parseCookieString(cookies);
  return {
    cookies,
    ...(parsed.__csrf !== undefined ? { csrf: parsed.__csrf } : {}),
  };
}

export type { NeteaseCredentials };
