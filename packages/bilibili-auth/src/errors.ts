/** 哔哩哔哩登录模块的统错误。 */
export type BilibiliAuthErrorCode =
  | "NETWORK"
  | "API_ERROR"
  | "AUTH_EXPIRED"
  | "LOGIN_REQUIRED"
  | "UNKNOWN";

export class BilibiliAuthError extends Error {
  readonly code: BilibiliAuthErrorCode;
  /** B 站 API 返回的错误码。 */
  readonly apiCode?: number;

  constructor(
    code: BilibiliAuthErrorCode,
    message: string,
    options?: ErrorOptions & { apiCode?: number },
  ) {
    super(message, options);
    this.name = "BilibiliAuthError";
    this.code = code;
    if (options?.apiCode !== undefined) {
      this.apiCode = options.apiCode;
    }
  }
}

/** 把未知错误规整为 BilibiliAuthError。 */
export function toBilibiliAuthError(error: unknown): BilibiliAuthError {
  if (error instanceof BilibiliAuthError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unknown bilibili auth error";
  if (
    message.includes("fetch failed") ||
    message.includes("ENOTFOUND") ||
    message.includes("ECONNREFUSED") ||
    message.includes("network")
  ) {
    return new BilibiliAuthError("NETWORK", message, { cause: error });
  }
  return new BilibiliAuthError("UNKNOWN", message, { cause: error });
}
