export type LlmErrorCode =
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "INVALID_REQUEST"
  | "MODEL_NOT_FOUND"
  | "OVERLOADED"
  | "NETWORK"
  | "CONFIGURATION"
  | "UNSUPPORTED"
  | "UNKNOWN";

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  /** HTTP 状态码(如来自 HTTP 响应)。 */
  readonly status?: number;
  /** 提供商原始错误信息。 */
  readonly provider?: string;

  constructor(
    code: LlmErrorCode,
    message: string,
    options?: ErrorOptions & { status?: number; provider?: string },
  ) {
    super(message, options);
    this.name = "LlmError";
    this.code = code;
    if (options?.status !== undefined) {
      this.status = options.status;
    }
    if (options?.provider !== undefined) {
      this.provider = options.provider;
    }
  }
}

/** 把 HTTP 状态码映射为统一错误码。 */
export function mapHttpStatus(status: number, provider: string): LlmErrorCode {
  if (status === 401 || status === 403) {
    return "AUTHENTICATION";
  }
  if (status === 429) {
    return "RATE_LIMIT";
  }
  if (status === 404) {
    return "MODEL_NOT_FOUND";
  }
  if (status >= 500) {
    return status === 529 ? "OVERLOADED" : "UNKNOWN";
  }
  if (status === 400 || status === 422) {
    return "INVALID_REQUEST";
  }
  return "UNKNOWN";
}

/** 从任意错误构造 LlmError。 */
export function toLlmError(error: unknown, provider: string): LlmError {
  if (error instanceof LlmError) {
    return error;
  }
  const record = (typeof error === "object" && error !== null ? error : {}) as Record<
    string,
    unknown
  >;
  const status = typeof record.status === "number" ? record.status : undefined;
  const message = error instanceof Error ? error.message : "Unknown LLM error";
  if (status !== undefined) {
    return new LlmError(mapHttpStatus(status, provider), message, {
      cause: error,
      status,
      provider,
    });
  }
  // fetch 网络错误
  if (
    message.includes("fetch failed") ||
    message.includes("ENOTFOUND") ||
    message.includes("ECONNREFUSED") ||
    message.includes("network")
  ) {
    return new LlmError("NETWORK", message, { cause: error, provider });
  }
  return new LlmError("UNKNOWN", message, { cause: error, provider });
}

/** 解析提供商错误响应的 JSON body 里的 message。 */
export function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) {
    return fallback;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.error === "object" && record.error !== null) {
    const err = record.error as Record<string, unknown>;
    if (typeof err.message === "string") {
      return err.message;
    }
  }
  if (typeof record.message === "string") {
    return record.message;
  }
  return fallback;
}
