/**
 * 统一错误类型与错误码。所有公开错误消息必须脱敏，不泄露 LCU token、端口命令行原文等敏感信息。
 */

export type LolErrorCode =
  | "CLIENT_NOT_RUNNING"
  | "DISCOVERY_FAILED"
  | "CONNECTION"
  | "NOT_FOUND"
  | "RATE_LIMIT"
  | "AUTH"
  | "TIMEOUT"
  | "UNKNOWN";

export interface LolErrorOptions {
  /** 底层原因（原始 Error / status / body 摘要），不会出现在公开 message 中 */
  cause?: unknown;
}

export class LolError extends Error {
  readonly code: LolErrorCode;
  override readonly cause?: unknown;

  constructor(code: LolErrorCode, message: string, options: LolErrorOptions = {}) {
    super(message);
    this.name = "LolError";
    this.code = code;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** 把任意未知错误归类为 LolError（已是 LolError 则原样返回） */
export function toLolError(error: unknown): LolError {
  if (error instanceof LolError) {
    return error;
  }
  if (error instanceof Error) {
    const code = classifyNativeError(error);
    return new LolError(code, sanitize(error.message), { cause: error });
  }
  return new LolError("UNKNOWN", "Unknown error", { cause: error });
}

function classifyNativeError(error: Error): LolErrorCode {
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") {
    if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED" || code === "ECONNABORTED") {
      return "CONNECTION";
    }
    if (code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
      return "CONNECTION";
    }
  }
  const message = error.message;
  if (message.includes("timeout") || message.includes("timed out")) {
    return "TIMEOUT";
  }
  if (message.includes("fetch failed") || message.includes("network")) {
    return "CONNECTION";
  }
  return "UNKNOWN";
}

/**
 * 把消息中的敏感片段替换为 [REDACTED]。
 * 调用方应传入本进程持有的 token 等值；默认同时脱敏通用敏感形态。
 */
export function sanitize(message: string, secrets: readonly string[] = []): string {
  let out = message;
  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  // 兜底：脱敏形如 --remoting-auth-token=xxx 的命令行片段
  out = out.replace(/--remoting-auth-token=\S+/gi, "--remoting-auth-token=[REDACTED]");
  return out;
}
