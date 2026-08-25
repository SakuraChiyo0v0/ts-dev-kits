/**
 * 传声筒统一错误模型:错误码 + 错误类 + 底层错误归类。
 * 本包不涉及凭据,错误消息保持可读与一致风格。
 */

/** 错误码枚举(权威定义) */
export enum ChuanshengtongErrorCode {
  /** 模板 id 不存在 */
  TEMPLATE_NOT_FOUND = "TEMPLATE_NOT_FOUND",
  /** 文字为空 */
  EMPTY_TEXT = "EMPTY_TEXT",
  /** 文字超出模板容量 */
  TEXT_TOO_LONG = "TEXT_TOO_LONG",
  /** 参数非法(负宽度/非法颜色/未知格式/质量越界) */
  INVALID_OPTION = "INVALID_OPTION",
  /** sharp 渲染失败 */
  RENDER_FAILED = "RENDER_FAILED",
  /** 写文件失败 */
  WRITE_FAILED = "WRITE_FAILED",
  /** 未归类错误 */
  UNKNOWN = "UNKNOWN",
}

/** 统一错误类 */
export class ChuanshengtongError extends Error {
  readonly code: ChuanshengtongErrorCode;

  constructor(code: ChuanshengtongErrorCode, message: string) {
    super(message);
    this.name = "ChuanshengtongError";
    this.code = code;
  }
}

/** 将任意底层错误归类为 ChuanshengtongError(未知错误保留原消息) */
export function asChuanshengtongError(err: unknown): ChuanshengtongError {
  if (err instanceof ChuanshengtongError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  return new ChuanshengtongError(ChuanshengtongErrorCode.UNKNOWN, message);
}
