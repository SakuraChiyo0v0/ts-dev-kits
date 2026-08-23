export type BilibiliErrorCode =
  | "NETWORK"
  | "API_ERROR"
  | "NOT_FOUND"
  | "LOGIN_REQUIRED"
  | "AUTH_EXPIRED"
  | "INVALID_URL"
  | "DOWNLOAD_FAILED"
  | "MERGE_FAILED"
  | "DISK_FULL"
  | "UNSUPPORTED_TYPE"
  | "UNKNOWN";

export class BilibiliError extends Error {
  readonly code: BilibiliErrorCode;
  /** B 站 API 返回的错误码。 */
  readonly apiCode?: number;

  constructor(
    code: BilibiliErrorCode,
    message: string,
    options?: ErrorOptions & { apiCode?: number },
  ) {
    super(message, options);
    this.name = "BilibiliError";
    this.code = code;
    if (options?.apiCode !== undefined) {
      this.apiCode = options.apiCode;
    }
  }
}

/** 校验 B 站 API 响应,非 0 code 抛错。 */
export function checkApiResponse(body: unknown, context: string): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new BilibiliError("API_ERROR", `${context}: invalid API response`, { cause: body });
  }
  const record = body as Record<string, unknown>;
  const code = Number(record.code ?? -1);
  if (code !== 0) {
    const message = String(record.message ?? "Unknown API error");
    throw new BilibiliError("API_ERROR", `${context}: ${message}`, {
      apiCode: code,
      cause: body,
    });
  }
  return record;
}

/** 把未知错误规整为 BilibiliError。 */
export function toBilibiliError(error: unknown): BilibiliError {
  if (error instanceof BilibiliError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unknown bilibili error";
  if (
    message.includes("fetch failed") ||
    message.includes("ENOTFOUND") ||
    message.includes("ECONNREFUSED") ||
    message.includes("network")
  ) {
    return new BilibiliError("NETWORK", message, { cause: error });
  }
  return new BilibiliError("UNKNOWN", message, { cause: error });
}
