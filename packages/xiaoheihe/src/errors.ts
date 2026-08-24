/**
 * XiaoheiheError —— 统一错误类型。错误消息与日志脱敏,不输出 cookie / token / 请求串。
 */
export type XiaoheiheErrorCode =
  | "NETWORK"
  | "API_ERROR"
  | "LOGIN_REQUIRED"
  | "AUTH_EXPIRED"
  | "CAPTCHA"
  | "RATE_LIMIT"
  | "INVALID_URL"
  | "TIMEOUT"
  | "CONFIGURATION"
  | "UNKNOWN";

/** 小黑盒统一错误类型。 */
export class XiaoheiheError extends Error {
  readonly code: XiaoheiheErrorCode;
  /** HTTP 状态码(可选)。 */
  readonly statusCode?: number;
  /** 服务端返回的 msg(可选,已脱敏)。 */
  readonly serverMsg?: string;
  /** 触发限流时服务端给出的重试等待秒数(可选)。 */
  readonly retryAfterSeconds?: number;

  constructor(
    code: XiaoheiheErrorCode,
    message: string,
    options?: ErrorOptions & { statusCode?: number; serverMsg?: string; retryAfterSeconds?: number },
  ) {
    super(message, options);
    this.name = "XiaoheiheError";
    this.code = code;
    if (options?.statusCode !== undefined) {
      this.statusCode = options.statusCode;
    }
    if (options?.serverMsg !== undefined) {
      this.serverMsg = options.serverMsg;
    }
    if (options?.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}

/** 把任意错误归类为 XiaoheiheError。 */
export function toXiaoheiheError(error: unknown, context: string): XiaoheiheError {
  if (error instanceof XiaoheiheError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unknown xiaoheihe error";
  if (
    message.includes("fetch failed") ||
    message.includes("ENOTFOUND") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ECONNRESET") ||
    message.includes("network")
  ) {
    return new XiaoheiheError("NETWORK", `${context}: ${message}`, { cause: error });
  }
  if (
    message.includes("timeout") ||
    message.includes("ETIMEDOUT") ||
    message.includes("AbortError") ||
    message.includes("aborted")
  ) {
    return new XiaoheiheError("TIMEOUT", `${context}: ${message}`, { cause: error });
  }
  return new XiaoheiheError("UNKNOWN", `${context}: ${message}`, { cause: error });
}
