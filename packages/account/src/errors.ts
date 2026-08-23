/** 通用认证底座错误码。 */
export type AccountErrorCode =
  | "NETWORK"
  | "API_ERROR"
  | "AUTH_EXPIRED"
  | "LOGIN_REQUIRED"
  | "UNKNOWN"
  // 密码登录骨架新增(追加,不修改现有行)
  | "INVALID_CREDENTIALS"
  | "TWO_FACTOR_REQUIRED"
  | "TWO_FACTOR_FAILED";

/** 认证底座统一错误类型。 */
export class AccountError extends Error {
  readonly code: AccountErrorCode;
  /** 平台 API 返回的错误码(可选)。 */
  readonly apiCode?: number;

  constructor(
    code: AccountErrorCode,
    message: string,
    options?: ErrorOptions & { apiCode?: number },
  ) {
    super(message, options);
    this.name = "AccountError";
    this.code = code;
    if (options?.apiCode !== undefined) {
      this.apiCode = options.apiCode;
    }
  }
}

/** 把未知错误规整为 AccountError(网络类错误归为 NETWORK)。 */
export function toAccountError(error: unknown, context: string): AccountError {
  if (error instanceof AccountError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unknown account error";
  if (
    message.includes("fetch failed") ||
    message.includes("ENOTFOUND") ||
    message.includes("ECONNREFUSED") ||
    message.includes("network")
  ) {
    return new AccountError("NETWORK", `${context}: ${message}`, { cause: error });
  }
  return new AccountError("UNKNOWN", `${context}: ${message}`, { cause: error });
}
