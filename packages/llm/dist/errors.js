export class LlmError extends Error {
    code;
    /** HTTP 状态码(如来自 HTTP 响应)。 */
    status;
    /** 提供商原始错误信息。 */
    provider;
    constructor(code, message, options) {
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
export function mapHttpStatus(status, provider) {
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
export function toLlmError(error, provider) {
    if (error instanceof LlmError) {
        return error;
    }
    const record = (typeof error === "object" && error !== null ? error : {});
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
    if (message.includes("fetch failed") ||
        message.includes("ENOTFOUND") ||
        message.includes("ECONNREFUSED") ||
        message.includes("network")) {
        return new LlmError("NETWORK", message, { cause: error, provider });
    }
    return new LlmError("UNKNOWN", message, { cause: error, provider });
}
/** 解析提供商错误响应的 JSON body 里的 message。 */
export function extractErrorMessage(body, fallback) {
    if (typeof body !== "object" || body === null) {
        return fallback;
    }
    const record = body;
    if (typeof record.error === "object" && record.error !== null) {
        const err = record.error;
        if (typeof err.message === "string") {
            return err.message;
        }
    }
    if (typeof record.message === "string") {
        return record.message;
    }
    return fallback;
}
