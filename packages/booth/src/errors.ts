/**
 * BOOTH SDK 统一错误类型。
 * 错误消息必须脱敏:不打印完整 cookie、不泄露签名 URL 参数。
 */
import type { BoothItem } from "./types.js";

/** 错误码。 */
export type BoothErrorCode =
  | "NETWORK"
  | "API_ERROR"
  | "NOT_FOUND"
  | "INVALID_URL"
  | "LOGIN_REQUIRED"
  | "AUTH_EXPIRED"
  | "ALREADY_OWNED"
  | "PAYMENT_REQUIRED"
  | "DOWNLOAD_FAILED"
  | "UNKNOWN";

const CODES = new Set<BoothErrorCode>([
  "NETWORK",
  "API_ERROR",
  "NOT_FOUND",
  "INVALID_URL",
  "LOGIN_REQUIRED",
  "AUTH_EXPIRED",
  "ALREADY_OWNED",
  "PAYMENT_REQUIRED",
  "DOWNLOAD_FAILED",
  "UNKNOWN",
]);

/** 统一错误类型。 */
export class BoothError extends Error {
  readonly code: BoothErrorCode;
  /** 附加的脱敏上下文(如商品 ID、订单号)。 */
  readonly context?: Record<string, string>;

  constructor(code: BoothErrorCode, message: string, context?: Record<string, string>) {
    super(message);
    this.name = "BoothError";
    this.code = code;
    if (context !== undefined) {
      this.context = context;
    }
  }
}

/** 检查未知错误是否为 BoothError。 */
export function isBoothError(error: unknown): error is BoothError {
  return error instanceof BoothError;
}

/**
 * 把底层错误归类为 BoothError。
 * - fetch 抛错(连接/超时/DNS) → NETWORK
 * - 已带 code 的 BoothError 原样返回
 * - 其它 → UNKNOWN
 */
export function toBoothError(error: unknown, context?: Record<string, string>): BoothError {
  if (error instanceof BoothError) {
    return error;
  }
  if (error instanceof TypeError && /fetch|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(error.message)) {
    return new BoothError("NETWORK", `network error: ${error.message}`, context);
  }
  return new BoothError("UNKNOWN", error instanceof Error ? error.message : String(error), context);
}

/** 校验响应状态;非 2xx 按状态码归类。 */
export function checkApiResponse(response: Response, context?: Record<string, string>): void {
  if (response.ok) {
    return;
  }
  if (response.status === 404) {
    throw new BoothError("NOT_FOUND", "resource not found", context);
  }
  if (response.status === 401 || response.status === 403) {
    throw new BoothError("LOGIN_REQUIRED", "login required or session expired", context);
  }
  throw new BoothError(
    "API_ERROR",
    `unexpected HTTP ${response.status} from BOOTH API`,
    context,
  );
}

/** 判断商品是否免费(0 日元)。 */
export function isFreeItem(item: BoothItem): boolean {
  return item.priceYen === 0;
}

/** 校验错误码是否合法(CLI/测试用)。 */
export function isBoothErrorCode(value: string): value is BoothErrorCode {
  return CODES.has(value as BoothErrorCode);
}
