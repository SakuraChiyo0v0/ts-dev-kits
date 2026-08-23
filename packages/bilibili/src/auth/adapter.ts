/**
 * B 站二维码登录适配器(QrLoginAdapter 实现)。
 *
 * 协议:
 *   1. GET passport.bilibili.com/x/passport-login/web/qrcode/generate → { data: { qrcode_key, url } }
 *   2. 轮询 GET passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=...:
 *      - data.code=0 成功:响应 Set-Cookie 含 SESSDATA/bili_jct/DedeUserID,data.refresh_token 为续期凭证
 *      - 86101/-2 未扫码、-5/86038/86102/86103 已扫待确认、-4/86090 二维码失效(重新生成)
 *   3. 续期:POST /x/passport-login/web/cookie/refresh { csrf, refresh_token, source } → 新 Set-Cookie + 新 refresh_token
 *
 * 凭证:credentials = { cookies, refreshToken, buvid3? }。
 * 兼容:老格式 auth.json(顶层 cookies/refreshToken 字段,非 AuthPayload)在 deserialize 时识别并迁移。
 */
import type { AuthPayload, PlatformCredentials, QrLoginAdapter } from "@sakurachiyo0v0/account";
import { BilibiliError } from "../errors.js";
import { parseCookieString } from "./cookie.js";

const PASSPORT_BASE = "https://passport.bilibili.com";
const GENERATE_URL = "/x/passport-login/web/qrcode/generate";
const POLL_URL = "/x/passport-login/web/qrcode/poll";
const REFRESH_URL = "/x/passport-login/web/cookie/refresh";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** B 站登录凭证。 */
export type BilibiliCredentials = {
  /** 完整 cookie 字符串,如 "SESSDATA=...; bili_jct=...; DedeUserID=..."。 */
  cookies: string;
  /** 续期用 refresh_token。 */
  refreshToken: string;
  /** 匿名 buvid3(可选,保持请求特征稳定)。 */
  buvid3?: string;
};

/** 扫码状态码(旧版数字码与新版字符码并存)。 */
const CODE_WAITING = new Set([-2, 86101]);
const CODE_SCANNED = new Set([-5, 86038, 86102, 86103]);
const CODE_EXPIRED = new Set([-4, 86090]);

/** 登录成功后 cookie 过期时间(约 90 天)。 */
const COOKIE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** B 站二维码登录适配器。 */
export function bilibiliQrAdapter(options: {
  /** 测试用:覆盖 passport 接口根地址。 */
  baseUrl?: string;
} = {}): QrLoginAdapter {
  const base = (options.baseUrl ?? PASSPORT_BASE).replace(/\/+$/u, "");

  async function generateKey(fetchImpl: typeof fetch): Promise<{ key: string; url: string }> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${GENERATE_URL}`, {
        headers: {
          "user-agent": USER_AGENT,
          referer: "https://passport.bilibili.com/login",
          accept: "application/json, text/plain, */*",
        },
      });
    } catch (error) {
      throw new BilibiliError("NETWORK", "生成登录二维码失败", { cause: error });
    }
    const body = (await response.json()) as Record<string, unknown>;
    const code = Number(body.code ?? -1);
    if (code !== 0) {
      throw new BilibiliError("API_ERROR", `生成登录二维码失败(code=${code})`, {
        apiCode: code,
        cause: body,
      });
    }
    const data = (body.data ?? {}) as Record<string, unknown>;
    const key = typeof data.qrcode_key === "string" ? data.qrcode_key : "";
    const url = typeof data.url === "string" ? data.url : "";
    if (key === "" || url === "") {
      throw new BilibiliError("API_ERROR", "生成登录二维码响应缺少 qrcode_key", { cause: body });
    }
    return { key, url };
  }

  async function pollStatus(
    key: string,
    fetchImpl: typeof fetch,
  ): Promise<{
    state: "waiting" | "scanned" | "success" | "expired";
    message: string;
    credentials?: BilibiliCredentials;
  }> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${POLL_URL}?qrcode_key=${encodeURIComponent(key)}`, {
        headers: {
          "user-agent": USER_AGENT,
          referer: "https://passport.bilibili.com/login",
          accept: "application/json, text/plain, */*",
        },
      });
    } catch (error) {
      throw new BilibiliError("NETWORK", "轮询登录状态失败", { cause: error });
    }
    const body = (await response.json()) as Record<string, unknown>;
    // 外层 code 恒为 0,状态在 data.code。
    const data = (body.data ?? {}) as Record<string, unknown>;
    const code = Number(data.code ?? -1);
    const message = String(data.message ?? "");

    if (code === 0) {
      // 成功:收集 Set-Cookie + refresh_token。
      const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : "";
      const setCookies: string[] = [];
      for (const header of response.headers.getSetCookie?.() ?? []) {
        const eq = header.indexOf("=");
        if (eq <= 0) continue;
        setCookies.push(header.slice(0, eq + 1) + (header.slice(eq + 1).split(";")[0] ?? ""));
      }
      const cookies = setCookies.join("; ");
      const parsed = parseCookieString(cookies);
      if (parsed.SESSDATA === undefined || parsed.SESSDATA === "") {
        throw new BilibiliError("API_ERROR", "登录成功但响应缺少 SESSDATA cookie", {
          cause: body,
        });
      }
      const credentials: BilibiliCredentials = {
        cookies,
        refreshToken,
        ...(parsed.buvid3 !== undefined ? { buvid3: parsed.buvid3 } : {}),
      };
      return { state: "success", message: "登录成功", credentials };
    }
    if (CODE_EXPIRED.has(code)) {
      return { state: "expired", message: "二维码已过期,正在重新生成" };
    }
    if (CODE_SCANNED.has(code)) {
      return { state: "scanned", message: "已扫码,请在手机上确认" };
    }
    if (CODE_WAITING.has(code)) {
      return { state: "waiting", message: "请使用哔哩哔哩 App 扫码" };
    }
    // 未知状态码:不打断用户扫码,交给超时兜底。
    return { state: "waiting", message: `等待扫码(${code})` };
  }

  async function refresh(
    credentials: PlatformCredentials,
    fetchImpl: typeof fetch,
  ): Promise<BilibiliCredentials> {
    const current = credentials as Partial<BilibiliCredentials>;
    const cookies = parseCookieString(current.cookies ?? "");
    const csrf = cookies.bili_jct;
    if (csrf === undefined || csrf === "") {
      throw new BilibiliError(
        "AUTH_EXPIRED",
        "登录态缺少 bili_jct,无法续期,请重新 login",
      );
    }

    let response: Response;
    try {
      response = await fetchImpl(`${base}${REFRESH_URL}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": USER_AGENT,
          referer: "https://www.bilibili.com/",
          accept: "application/json, text/plain, */*",
        },
        body: JSON.stringify({
          csrf,
          refresh_token: current.refreshToken ?? "",
          source: "main_web",
        }),
      });
    } catch (error) {
      throw new BilibiliError("NETWORK", "续期请求失败", { cause: error });
    }

    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new BilibiliError("API_ERROR", "续期接口返回了非 JSON 响应", { cause: text });
    }
    const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const code = Number(record.code ?? -1);
    if (code !== 0) {
      // -101 / -400:refresh_token 失效,需要重新扫码。
      throw new BilibiliError(
        "AUTH_EXPIRED",
        `登录态已失效(code=${code}),请重新执行 login`,
        { apiCode: code, cause: body },
      );
    }

    const dataRecord = (record.data ?? {}) as Record<string, unknown>;
    const newRefreshToken = typeof dataRecord.refresh_token === "string" ? dataRecord.refresh_token : "";
    if (newRefreshToken === "") {
      throw new BilibiliError("API_ERROR", "续期响应缺少 refresh_token", { cause: body });
    }

    // 合并新 Set-Cookie(覆盖旧值)。
    const merged = { ...cookies };
    for (const header of response.headers.getSetCookie?.() ?? []) {
      const eq = header.indexOf("=");
      if (eq <= 0) continue;
      const name = header.slice(0, eq);
      const value = header.slice(eq + 1).split(";")[0] ?? "";
      merged[name] = value;
    }
    const newCookies = Object.entries(merged)
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");

    return {
      cookies: newCookies,
      refreshToken: newRefreshToken,
      ...(typeof current.buvid3 === "string" && current.buvid3 !== ""
        ? { buvid3: current.buvid3 }
        : {}),
    };
  }

  return {
    platform: "bilibili",
    generateKey,
    pollStatus,
    refresh,
    serialize(credentials: PlatformCredentials, savedAt: string): AuthPayload {
      const current = credentials as Partial<BilibiliCredentials>;
      const payload: AuthPayload = {
        platform: "bilibili",
        credentials: {
          cookies: String(current.cookies ?? ""),
          refreshToken: String(current.refreshToken ?? ""),
          ...(typeof current.buvid3 === "string" && current.buvid3 !== ""
            ? { buvid3: current.buvid3 }
            : {}),
        },
        savedAt,
      };
      return payload;
    },
    deserialize(payload: AuthPayload): PlatformCredentials | null {
      // 兼容老格式:顶层直接是 cookies/refreshToken 字段(bilibili-auth AuthData)。
      const legacy = payload as unknown as Partial<BilibiliCredentials>;
      if (
        typeof legacy.cookies === "string" &&
        legacy.cookies !== "" &&
        typeof legacy.refreshToken === "string" &&
        legacy.refreshToken !== ""
      ) {
        return {
          cookies: legacy.cookies,
          refreshToken: legacy.refreshToken,
          ...(typeof legacy.buvid3 === "string" && legacy.buvid3 !== ""
            ? { buvid3: legacy.buvid3 }
            : {}),
        };
      }
      if (payload.platform !== "bilibili") {
        return null;
      }
      const cred = payload.credentials as Partial<BilibiliCredentials>;
      if (typeof cred.cookies !== "string" || cred.cookies === "") {
        return null;
      }
      if (typeof cred.refreshToken !== "string" || cred.refreshToken === "") {
        return null;
      }
      return {
        cookies: cred.cookies,
        refreshToken: cred.refreshToken,
        ...(typeof cred.buvid3 === "string" && cred.buvid3 !== ""
          ? { buvid3: cred.buvid3 }
          : {}),
      };
    },
  };
}

export type { QrLoginAdapter };
