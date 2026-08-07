export type ChatPlatformErrorCode =
  | "CONFIGURATION"
  | "VALIDATION"
  | "AUTHENTICATION"
  | "CONNECTION"
  | "DELIVERY"
  | "NOT_FOUND"
  | "UNKNOWN";

export class ChatPlatformError extends Error {
  readonly code: ChatPlatformErrorCode;

  constructor(code: ChatPlatformErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatPlatformError";
    this.code = code;
  }
}

/** 从任意错误归类为统一错误码（参考 email 包 toEmailError 模式） */
export function toChatPlatformError(error: unknown): ChatPlatformError {
  if (error instanceof ChatPlatformError) {
    return error;
  }
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const sourceMessage = error instanceof Error ? error.message : "Unknown chat platform error";
  const code = String(record.code ?? "");

  if (code.startsWith("E_") || code === "E_AUTH") {
    return new ChatPlatformError("AUTHENTICATION", sourceMessage, { cause: error });
  }
  if (
    code.startsWith("ECONN") ||
    code === "ETIMEDOUT" ||
    code === "E_WS_CONNECT_FAILED"
  ) {
    return new ChatPlatformError("CONNECTION", sourceMessage, { cause: error });
  }
  if (code === "E_NOT_FOUND" || code === "E_CHAT_NOT_FOUND") {
    return new ChatPlatformError("NOT_FOUND", sourceMessage, { cause: error });
  }
  return new ChatPlatformError("UNKNOWN", sourceMessage, { cause: error });
}
