/** 下载器错误码。 */
export type DownloaderErrorCode =
  | "INVALID_TARGET"
  | "DOWNLOAD_FAILED"
  | "EMPTY_BODY";

/** 下载器统一错误。消息不包含任何凭据。 */
export class DownloaderError extends Error {
  readonly code: DownloaderErrorCode;

  constructor(code: DownloaderErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DownloaderError";
    this.code = code;
  }
}
