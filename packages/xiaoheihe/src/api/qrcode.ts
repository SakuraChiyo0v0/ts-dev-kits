/**
 * 登录域 —— 二维码扫码登录 + QrLoginAdapter 适配器。
 * 流程对照 Go 参考实现(login.go):GET /account/get_qrcode_url/ 取二维码 → 轮询
 * /account/qr_state/ 直到 result.error == "ok" → 从 Set-Cookie 提取凭证并构造
 * x_xhh_tokenid(4 个 MD5 盐值 + NUL 的 base64)。
 * 改进:遍历全部 Set-Cookie 按名提取,不依赖响应顺序(参考实现直接下标 cookie[0]/[1])。
 */
import type { AuthPayload, PlatformCredentials, QrLoginAdapter } from "@sakurachiyo0v0/account";
import { createHash } from "node:crypto";
import { XiaoheiheError } from "../errors.js";
import { XiaoheiheHttpTransport, type XiaoheiheFetch } from "../transport.js";
import type { QrcodeResult, XiaoheiheCredentials } from "../types.js";

/** 登录二维码/轮询响应外壳。 */
interface QrResponse {
  status?: string;
  msg?: string;
  result?: {
    qr_url?: string;
    expire?: number;
    error?: string;
    error_msg?: string;
    nickname?: string;
  };
}

/** 从响应头收集全部 Set-Cookie(兼容 getSetCookie 与降级单值)。 */
function collectSetCookies(headers: Headers): string[] {
  const typed = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof typed.getSetCookie === "function") {
    return typed.getSetCookie();
  }
  const value = headers.get("set-cookie");
  return value !== null && value !== "" ? [value] : [];
}

/** 解析 Set-Cookie 条目为 name=value(丢弃属性)。 */
function cookieNameValue(raw: string): string | undefined {
  const first = raw.split(";")[0]?.trim();
  if (first === undefined || first === "" || !first.includes("=")) {
    return undefined;
  }
  return first;
}

/** 构造 x_xhh_tokenid(GetFuckingToken,对照 login.go)。time 为登录时刻 unix 秒。 */
export function buildTokenId(time: number): string {
  const parts = [
    createHash("md5").update(String(time)).digest(),
    createHash("md5").update("唉？！云朵！").digest(),
    createHash("md5").update("哒哒哒哒哒，好想玩原神").digest(),
    createHash("md5").update("云！原！神！").digest(),
    Buffer.from([0x00]),
  ];
  const raw = Buffer.concat(parts);
  return raw.toString("base64");
}

/**
 * 从 qr_state 响应头提取登录凭证:
 * - 全部 Set-Cookie 中 user_heybox_id 的值 → heyboxId;
 * - 其余 name=value 全部拼接为 cookie 头;
 * - 追加 x_xhh_tokenid。
 */
export function buildCredentials(
  headers: Headers,
  time: number,
): XiaoheiheCredentials | null {
  const setCookies = collectSetCookies(headers);
  if (setCookies.length === 0) {
    return null;
  }
  let heyboxId = "";
  const parts: string[] = [];
  for (const raw of setCookies) {
    const nameValue = cookieNameValue(raw);
    if (nameValue === undefined) {
      continue;
    }
    const [name, value] = nameValue.split("=");
    if (name === undefined || value === undefined || name === "") {
      continue;
    }
    if (name === "user_heybox_id") {
      heyboxId = value;
      continue;
    }
    parts.push(`${name}=${value}`);
  }
  if (parts.length === 0) {
    return null;
  }
  const cookie = `${parts.join(";")};x_xhh_tokenid=${buildTokenId(time)}`;
  return { cookie, heyboxId, time };
}

/** 登录适配器选项。 */
export interface XiaoheiheQrAdapterOptions {
  /** 覆盖 base URL(测试 mock 用)。 */
  baseUrl?: string;
}

/** 小黑盒扫码登录适配器(供 account 的 qrcodeLogin 使用)。 */
export function xiaoheiheQrAdapter(options: XiaoheiheQrAdapterOptions = {}): QrLoginAdapter {
  // account 接口的 fetch 参数类型与本包 XiaoheiheFetch 跨包解析时可能不同源,
  // 这里显式桥接一次,内部统一用 XiaoheiheFetch。
  const makeTransport = (fetchImpl: unknown) =>
    new XiaoheiheHttpTransport({
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      fetchImpl: fetchImpl as XiaoheiheFetch,
    });

  return {
    platform: "xiaoheihe",

    async generateKey(fetchImpl) {
      const transport = makeTransport(fetchImpl);
      const body = await transport.requestRaw<QrResponse>({ path: "/account/get_qrcode_url/" });
      const qrUrl = body.body?.result?.qr_url;
      if (typeof qrUrl !== "string" || qrUrl === "") {
        throw new XiaoheiheError("API_ERROR", "获取小黑盒登录二维码失败:响应缺少 qr_url");
      }
      return { key: qrUrl, url: qrUrl };
    },

    async pollStatus(key, fetchImpl) {
      const transport = makeTransport(fetchImpl);
      // 从 qr_url 提取参数(对照 login.go:78 的字符串截断;这里用 URL 解析更健壮,
      // 不依赖固定域名前缀)。
      let params: Record<string, string> = {};
      try {
        const parsed = new URL(key);
        parsed.searchParams.forEach((value, name) => {
          params[name] = value;
        });
      } catch {
        params = parseQuery(key);
      }
      const { headers, body } = await transport.requestRaw<QrResponse>({
        path: "/account/qr_state/",
        params,
      });
      const error = body?.result?.error;
      const errorMsg = body?.result?.error_msg ?? "";
      if (error === "ok") {
        const time = Math.floor(Date.now() / 1000);
        const credentials = buildCredentials(headers, time);
        if (credentials === null) {
          throw new XiaoheiheError("API_ERROR", "扫码成功但响应缺少登录凭证(Set-Cookie),请重试");
        }
        return {
          state: "success",
          message: "扫码成功",
          credentials: {
            cookie: credentials.cookie,
            heyboxId: credentials.heyboxId,
            time: credentials.time,
          },
        };
      }
      // 按 error 值区分状态;未知值一律视为等待中。
      if (error === "expired") {
        return { state: "expired", message: errorMsg || "二维码已过期" };
      }
      if (error === "scanned") {
        return { state: "scanned", message: errorMsg || "已扫码,请在手机上确认" };
      }
      return { state: "waiting", message: errorMsg || "等待扫码" };
    },

    serialize(credentials, savedAt): AuthPayload {
      const { cookie, heyboxId, time } = credentials as unknown as XiaoheiheCredentials;
      return {
        platform: "xiaoheihe",
        credentials: { cookie, heyboxId, time },
        savedAt,
      };
    },

    deserialize(payload): PlatformCredentials | null {
      const credentials = payload.credentials as Partial<XiaoheiheCredentials> | undefined;
      if (
        credentials === undefined ||
        typeof credentials.cookie !== "string" ||
        credentials.cookie === "" ||
        typeof credentials.heyboxId !== "string" ||
        typeof credentials.time !== "number"
      ) {
        return null;
      }
      return {
        cookie: credentials.cookie,
        heyboxId: credentials.heyboxId,
        time: credentials.time,
      };
    },
  };
}

/** 把 "k=v&k2=v2" 解析为参数对象(重复键取首个)。 */
function parseQuery(query: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of query.split("&")) {
    if (pair === "") {
      continue;
    }
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? "" : pair.slice(eq + 1);
    if (key !== "" && params[key] === undefined) {
      params[key] = value;
    }
  }
  return params;
}
