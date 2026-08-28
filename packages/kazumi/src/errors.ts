/** kazumi SDK 统一错误类。消息已脱敏,不包含 cookie/UA 敏感内容。 */
export class KazumiError extends Error {
  constructor(
    readonly code: KazumiErrorCode,
    message: string,
    /** 底层错误原因(ES2022 Error.cause,需 override 修饰)。 */
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "KazumiError";
  }
}

/** 统一错误码。 */
export type KazumiErrorCode =
  | "RULE_NOT_FOUND"
  | "RULE_INVALID"
  | "NO_RESULT"
  | "NETWORK"
  | "CAPTCHA"
  | "STREAM_PARSE_FAILED"
  | "DOWNLOAD_FAILED"
  | "MERGE_FAILED"
  | "UNKNOWN";

/** 把底层错误归类为 KazumiError。 */
export function toKazumiError(
  code: KazumiErrorCode,
  message: string,
  cause?: unknown,
): KazumiError {
  if (cause instanceof KazumiError) return cause;
  return new KazumiError(code, message, cause);
}
