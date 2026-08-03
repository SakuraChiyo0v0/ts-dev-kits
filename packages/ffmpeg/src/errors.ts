export type FfmpegErrorCode =
  | "CONFIGURATION"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "CANCELLED"
  | "PROCESS_ERROR"
  | "UNKNOWN";

export class FfmpegError extends Error {
  readonly code: FfmpegErrorCode;
  /** 底层进程的退出码(仅 PROCESS_ERROR 有)。 */
  readonly exitCode?: number;
  /** ffmpeg/ffprobe 的 stderr 输出(供调试)。 */
  readonly stderr?: string;

  constructor(code: FfmpegErrorCode, message: string, options?: ErrorOptions & {
    exitCode?: number;
    stderr?: string;
  }) {
    super(message, options);
    this.name = "FfmpegError";
    this.code = code;
    if (options?.exitCode !== undefined) {
      this.exitCode = options.exitCode;
    }
    if (options?.stderr !== undefined) {
      this.stderr = options.stderr;
    }
  }
}

/** 把未知错误规整为 FfmpegError。 */
export function toFfmpegError(error: unknown): FfmpegError {
  if (error instanceof FfmpegError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unknown ffmpeg error";
  return new FfmpegError("UNKNOWN", message, { cause: error });
}
