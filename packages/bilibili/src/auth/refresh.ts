/**
 * 登录态续期 —— 用 refresh_token 换新 cookie,无需重新扫码。
 * 接口:POST passport.bilibili.com/x/passport-login/web/cookie/refresh
 */
import { BilibiliError } from "../errors.js";
import { parseCookieString } from "../network.js";
import type { AuthData } from "./store.js";

const REFRESH_URL = "https://passport.bilibili.com/x/passport-login/web/cookie/refresh";

/** 用 refresh_token 换新 cookie,返回更新后的登录态。失败抛 BilibiliError。 */
export async function refreshCookies(
  data: AuthData,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthData> {
  const cookies = parseCookieString(data.cookies);
  const csrf = cookies.bili_jct;
  if (csrf === undefined || csrf === "") {
    throw new BilibiliError(
      "AUTH_EXPIRED",
      "登录态缺少 bili_jct,无法续期,请重新 login",
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(REFRESH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        referer: "https://www.bilibili.com/",
        accept: "application/json, text/plain, */*",
      },
      body: JSON.stringify({
        csrf,
        refresh_token: data.refreshToken,
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
  const setCookies = response.headers.getSetCookie?.() ?? [];
  const merged = { ...cookies };
  for (const header of setCookies) {
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
    ...(typeof data.buvid3 === "string" && data.buvid3 !== "" ? { buvid3: data.buvid3 } : {}),
    savedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  };
}
