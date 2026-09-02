import { rsaEncryptBase64, md5Hex } from "./crypto.js";
import { UgAppError, UgAppErrorCode } from "./errors.js";
import { httpRequest } from "./http.js";
import type { CookieStore, UgAppConfig, UgGatewayKind } from "./types.js";

export const DEFAULT_BASE_DIR = "/DXP4800GT/AmeChan/下载";
export const DEFAULT_COOKIE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_TIMEOUT_MS = 30_000;

/** 解析并校验配置：缺失字段与非法路径直接抛 VALIDATION */
export type ResolvedConfig = {
  appHost: string;
  proxyId: string;
  kind: UgGatewayKind;
  username: string;
  password: string;
  baseDir: string;
  cookieTtlMs: number;
  timeoutMs: number;
};

/** 按 appHost 后缀自动识别网关类型：.ugdocker.link → ugdocker，其余 → ugapp */
export function inferKind(appHost: string): UgGatewayKind {
  return /\.ugdocker\.link$/i.test(appHost) ? "ugdocker" : "ugapp";
}

export function resolveConfig(cfg: UgAppConfig): ResolvedConfig {
  const missing: string[] = [];
  if (!cfg.appHost?.trim()) missing.push("appHost");
  if (!cfg.proxyId?.trim()) missing.push("proxyId");
  if (!cfg.username?.trim()) missing.push("username");
  if (!cfg.password) missing.push("password");
  if (missing.length > 0) {
    throw new UgAppError(UgAppErrorCode.VALIDATION, `UGOS 配置不完整：${missing.join(" / ")} 都需要填写`);
  }
  const baseDir = (cfg.baseDir ?? DEFAULT_BASE_DIR).trim();
  if (!baseDir.startsWith("/")) {
    throw new UgAppError(UgAppErrorCode.VALIDATION, `默认目录必须以 / 开头：${baseDir}`);
  }
  return {
    appHost: cfg.appHost.trim(),
    proxyId: cfg.proxyId.trim(),
    kind: cfg.kind ?? inferKind(cfg.appHost),
    username: cfg.username.trim(),
    password: cfg.password,
    baseDir,
    cookieTtlMs: cfg.cookieTtlMs ?? DEFAULT_COOKIE_TTL_MS,
    timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/** 从 appHost + proxyId 推导 UGOS 主机（app-{proxyId}-{host}.ugapp.link / app-{port}-{host}.ugdocker.link → {host}.ug.link） */
export function deriveUgHost(appHost: string, proxyId: string): string {
  let h = appHost.replace(/\.(ugapp|ugdocker)\.link$/i, ".ug.link");
  h = h.replace(new RegExp(`^app-${proxyId}-`, "i"), "");
  return h;
}

/** 拿网关会话 cookie：缓存命中直接返回，否则走完整登录链路并写入缓存 */
export async function acquireCookie(cfg: ResolvedConfig, store: CookieStore): Promise<string> {
  if (cfg.cookieTtlMs > 0) {
    const cached = store.get();
    if (cached && Date.now() - cached.savedAt <= cfg.cookieTtlMs) return cached.cookie;
  }
  const cookie = await loginFlow(cfg);
  if (cfg.cookieTtlMs > 0) store.set(cookie, Date.now());
  return cookie;
}

/**
 * 完整 UGOS 登录链路：
 *   1. POST /ugreen/v1/verify/check        → 响应头 X-Rsa-Token 返回 RSA 公钥
 *   2. 用该公钥按 RSA PKCS#1 v1.5 加密密码
 *   3. POST /ugreen/v1/verify/login        → 会话 cookie + token(api_token) + 第二把公钥
 *   4. GET  /ugreen/v1/gateway/proxy/onceToken?proxy_id=…（ugapp）
 *      或  /ugreen/v1/gateway/proxy/dockerToken?port=…（ugdocker）→ 一次性令牌
 *   5. GET  {appHost}/api/ugreen/auth?token=… → HTML 里带「轮换后的」ugreen-proxy-token
 */
async function loginFlow(cfg: ResolvedConfig): Promise<string> {
  const ugHost = deriveUgHost(cfg.appHost, cfg.proxyId);
  const { timeoutMs } = cfg;

  // 1. 预检拿 RSA 公钥
  const ck = await httpRequest(ugHost, "POST", "/ugreen/v1/verify/check", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: cfg.username }),
    timeoutMs,
  });
  const b64Pem = ck.headers["x-rsa-token"];
  if (typeof b64Pem !== "string" || !b64Pem) {
    throw new UgAppError(UgAppErrorCode.LOGIN, `UGOS 预检失败（HTTP ${ck.status}），请检查网关地址/应用 ID`);
  }
  const pem = Buffer.from(b64Pem, "base64").toString("utf8");

  // 2 + 3. 加密密码并登录
  const encPwd = rsaEncryptBase64(pem, cfg.password);
  const lg = await httpRequest(ugHost, "POST", "/ugreen/v1/verify/login", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: cfg.username,
      password: encPwd,
      keepalive: false,
      otp: true,
      is_simple: true,
    }),
    timeoutMs,
  });
  let loginBody: { code: number; msg?: string; data?: { token?: string; public_key?: string } };
  try {
    loginBody = JSON.parse(lg.body.toString());
  } catch {
    throw new UgAppError(UgAppErrorCode.LOGIN, `UGOS 登录返回异常（HTTP ${lg.status}）`);
  }
  if (loginBody.code !== 200 || !loginBody.data?.token) {
    throw new UgAppError(UgAppErrorCode.AUTHENTICATION, `UGOS 登录失败：${loginBody.msg ?? `code ${loginBody.code}`}（检查用户名/密码）`);
  }
  const setCookies = Array.isArray(lg.headers["set-cookie"])
    ? lg.headers["set-cookie"]
    : lg.headers["set-cookie"]
      ? [lg.headers["set-cookie"]]
      : [];
  const tokenCookie = setCookies.find((c) => c.startsWith("token="));
  if (!tokenCookie) throw new UgAppError(UgAppErrorCode.LOGIN, "UGOS 登录成功但未返回会话 cookie");
  const ugCookie = String(tokenCookie).split(";")[0] + "; token_uid=1000";
  const apiToken = loginBody.data.token;
  const pub2 = Buffer.from(loginBody.data.public_key ?? "", "base64").toString("utf8");

  // 4. 一次性令牌（开代理应用）；ugdocker 网关按端口取令牌
  const tokenPath =
    cfg.kind === "ugdocker"
      ? `/ugreen/v1/gateway/proxy/dockerToken?port=${encodeURIComponent(cfg.proxyId)}`
      : `/ugreen/v1/gateway/proxy/onceToken?proxy_id=${encodeURIComponent(cfg.proxyId)}`;
  const ot = await httpRequest(
    ugHost,
    "GET",
    tokenPath,
    {
      headers: {
        Cookie: ugCookie,
        "X-Ugreen-Token": rsaEncryptBase64(pub2, apiToken),
        "X-Ugreen-Security-Key": md5Hex(apiToken),
        "Client-Id": "ugreen-sdk",
      },
      timeoutMs,
    }
  );
  let otBody: { code: number; msg?: string; data?: { token?: string } };
  try {
    otBody = JSON.parse(ot.body.toString());
  } catch {
    throw new UgAppError(UgAppErrorCode.LOGIN, `获取网关令牌失败（HTTP ${ot.status}）`);
  }
  if (otBody.code !== 200 || !otBody.data?.token) {
    throw new UgAppError(UgAppErrorCode.LOGIN, `获取网关令牌失败：${otBody.msg ?? `code ${otBody.code}`}`);
  }

  // 5. 网关认证页会轮换出真正的会话 cookie（ugreen-proxy-token）
  const au = await httpRequest(
    cfg.appHost,
    "GET",
    `/api/ugreen/auth?token=${encodeURIComponent(otBody.data.token)}`,
    { timeoutMs }
  );
  const html = au.body.toString();
  const m = html.match(/ugreen-proxy-token=([^;]+)/);
  if (!m) throw new UgAppError(UgAppErrorCode.LOGIN, "网关认证失败：未能拿到 ugreen-proxy-token");
  return "ugreen-proxy-token=" + m[1];
}
