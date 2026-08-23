/**
 * VrchatError —— 统一错误类型。错误消息与日志脱敏,不输出 cookie / 用户名密码。
 */
export type VrchatErrorCode =
  | "LOGIN_REQUIRED"
  | "AUTH_EXPIRED"
  | "INVALID_CREDENTIALS"
  | "TWO_FACTOR_REQUIRED"
  | "TWO_FACTOR_FAILED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "RATE_LIMIT"
  | "NETWORK"
  | "TIMEOUT"
  | "UNKNOWN";

/** VRChat API 统一错误类型。 */
export class VrchatError extends Error {
  readonly code: VrchatErrorCode;
  /** VRChat API 返回的 HTTP 状态码(可选)。 */
  readonly statusCode?: number;
  /** 触发限流时服务端给出的重试等待秒数(可选)。 */
  readonly retryAfterSeconds?: number;

  constructor(
    code: VrchatErrorCode,
    message: string,
    options?: ErrorOptions & { statusCode?: number; retryAfterSeconds?: number },
  ) {
    super(message, options);
    this.name = "VrchatError";
    this.code = code;
    if (options?.statusCode !== undefined) {
      this.statusCode = options.statusCode;
    }
    if (options?.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}

/**
 * 把任意错误归类为 VrchatError:
 * - 已是 VrchatError 原样返回;
 * - 网络类错误(连接失败/DNS/超时)归为 NETWORK / TIMEOUT;
 * - 其余归为 UNKNOWN。
 */
export function toVrchatError(error: unknown, context: string): VrchatError {
  if (error instanceof VrchatError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unknown vrchat error";
  if (
    message.includes("fetch failed") ||
    message.includes("ENOTFOUND") ||
    message.includes("ECONNREFUSED") ||
    message.includes("network")
  ) {
    return new VrchatError("NETWORK", `${context}: ${message}`, { cause: error });
  }
  if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
    return new VrchatError("TIMEOUT", `${context}: ${message}`, { cause: error });
  }
  return new VrchatError("UNKNOWN", `${context}: ${message}`, { cause: error });
}
