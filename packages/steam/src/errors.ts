/**
 * SteamError —— 统一错误类型。错误消息与日志脱敏,不输出 API key / cookie / 密码 / 会话串。
 */
export type SteamErrorCode =
  | "NETWORK"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "AUTH_EXPIRED"
  | "LOGIN_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_URL"
  | "INVALID_CREDENTIALS"
  | "TWO_FACTOR_REQUIRED"
  | "TWO_FACTOR_FAILED"
  | "CONFIGURATION"
  | "UNKNOWN";

/** Steam 统一错误类型。 */
export class SteamError extends Error {
  readonly code: SteamErrorCode;
  /** Steam 服务端返回的 HTTP 状态码(可选)。 */
  readonly statusCode?: number;
  /** 触发限流时服务端给出的重试等待秒数(可选)。 */
  readonly retryAfterSeconds?: number;

  constructor(
    code: SteamErrorCode,
    message: string,
    options?: ErrorOptions & { statusCode?: number; retryAfterSeconds?: number },
  ) {
    super(message, options);
    this.name = "SteamError";
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
 * 把任意错误归类为 SteamError:
 * - 已是 SteamError 原样返回;
 * - 网络类错误(连接失败/DNS/拒绝)归为 NETWORK;
 * - 超时/中断归为 TIMEOUT;
 * - 其余归为 UNKNOWN。
 */
export function toSteamError(error: unknown, context: string): SteamError {
  if (error instanceof SteamError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unknown steam error";
  if (
    message.includes("fetch failed") ||
    message.includes("ENOTFOUND") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ECONNRESET") ||
    message.includes("network")
  ) {
    return new SteamError("NETWORK", `${context}: ${message}`, { cause: error });
  }
  if (
    message.includes("timeout") ||
    message.includes("ETIMEDOUT") ||
    message.includes("AbortError") ||
    message.includes("aborted")
  ) {
    return new SteamError("TIMEOUT", `${context}: ${message}`, { cause: error });
  }
  return new SteamError("UNKNOWN", `${context}: ${message}`, { cause: error });
}
