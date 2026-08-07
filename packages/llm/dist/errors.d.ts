export type LlmErrorCode = "AUTHENTICATION" | "RATE_LIMIT" | "TIMEOUT" | "INVALID_REQUEST" | "MODEL_NOT_FOUND" | "OVERLOADED" | "NETWORK" | "CONFIGURATION" | "UNSUPPORTED" | "UNKNOWN";
export declare class LlmError extends Error {
    readonly code: LlmErrorCode;
    /** HTTP 状态码(如来自 HTTP 响应)。 */
    readonly status?: number;
    /** 提供商原始错误信息。 */
    readonly provider?: string;
    constructor(code: LlmErrorCode, message: string, options?: ErrorOptions & {
        status?: number;
        provider?: string;
    });
}
/** 把 HTTP 状态码映射为统一错误码。 */
export declare function mapHttpStatus(status: number, provider: string): LlmErrorCode;
/** 从任意错误构造 LlmError。 */
export declare function toLlmError(error: unknown, provider: string): LlmError;
/** 解析提供商错误响应的 JSON body 里的 message。 */
export declare function extractErrorMessage(body: unknown, fallback: string): string;
