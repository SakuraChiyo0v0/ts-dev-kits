/** 网易云音乐 SDK 错误码。 */
export type NeteaseErrorCode =
  | "NETWORK"
  | "API_ERROR"
  | "NOT_FOUND"
  | "INVALID_URL"
  | "LOGIN_REQUIRED"
  | "AUTH_EXPIRED"
  | "PRIVILEGE_DENIED"
  | "TRIAL_ONLY"
  | "DOWNLOAD_FAILED"
  | "UNKNOWN";

/** 网易云音乐 SDK 统一错误类型。 */
export class NeteaseError extends Error {
  readonly code: NeteaseErrorCode;
  /** 网易云 API 返回的错误码(可选)。 */
  readonly apiCode?: number;

  constructor(
    code: NeteaseErrorCode,
    message: string,
    options?: ErrorOptions & { apiCode?: number },
  ) {
    super(message, options);
    this.name = "NeteaseError";
    this.code = code;
    if (options?.apiCode !== undefined) {
      this.apiCode = options.apiCode;
    }
  }
}

/** 校验网易云 API 响应:非 200 code 抛错。 */
export function checkApiResponse(body: unknown, context: string): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new NeteaseError("API_ERROR", `${context}: invalid API response`, { cause: body });
  }
  const record = body as Record<string, unknown>;
  const code = Number(record.code ?? -1);
  if (code !== 200) {
    const message = String(record.message ?? "Unknown API error");
    // -462 / 301 表示登录态失效。
    if (code === -462 || code === 301) {
      throw new NeteaseError("AUTH_EXPIRED", `${context}: ${message}`, {
        apiCode: code,
        cause: body,
      });
    }
    throw new NeteaseError("API_ERROR", `${context}: ${message}`, {
      apiCode: code,
      cause: body,
    });
  }
  return record;
}

/** 把未知错误规整为 NeteaseError。 */
export function toNeteaseError(error: unknown, context: string): NeteaseError {
  if (error instanceof NeteaseError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unknown netease error";
  if (
    message.includes("fetch failed") ||
    message.includes("ENOTFOUND") ||
    message.includes("ECONNREFUSED") ||
    message.includes("network")
  ) {
    return new NeteaseError("NETWORK", `${context}: ${message}`, { cause: error });
  }
  return new NeteaseError("UNKNOWN", `${context}: ${message}`, { cause: error });
}
