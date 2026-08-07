export type ChatPlatformErrorCode = "CONFIGURATION" | "VALIDATION" | "AUTHENTICATION" | "CONNECTION" | "DELIVERY" | "NOT_FOUND" | "UNKNOWN";
export declare class ChatPlatformError extends Error {
    readonly code: ChatPlatformErrorCode;
    constructor(code: ChatPlatformErrorCode, message: string, options?: ErrorOptions);
}
/** 从任意错误归类为统一错误码（参考 email 包 toEmailError 模式） */
export declare function toChatPlatformError(error: unknown): ChatPlatformError;
