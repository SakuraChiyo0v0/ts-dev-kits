/** 统一错误码 */
export enum WebdavErrorCode {
  /** 认证失败(401/403) */
  AUTHENTICATION = "AUTHENTICATION",
  /** 网络/连接失败、超时 */
  CONNECTION = "CONNECTION",
  /** 文件/目录不存在(404) */
  NOT_FOUND = "NOT_FOUND",
  /** 冲突(409/412),如不覆盖写已存在文件 */
  CONFLICT = "CONFLICT",
  /** 参数非法(空 URL、非法路径) */
  VALIDATION = "VALIDATION",
  /** 其他未归类错误 */
  UNKNOWN = "UNKNOWN",
}

/** 统一错误类型:消息已脱敏(不泄露密码/token),原始错误保留在 cause */
export class WebdavError extends Error {
  readonly code: WebdavErrorCode;

  constructor(code: WebdavErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "WebdavError";
    this.code = code;
  }
}

/** 脱敏:抹掉 URL 里的账号密码与显式 password=/token= 参数 */
function sanitizeMessage(message: string): string {
  return message
    .replace(/([a-z]+):\/\/[^/\s:@]+:[^@\s/]+@/gi, "$1://***:***@")
    .replace(/(password|passwd|pwd|token)=([^&\s]+)/gi, "$1=***");
}

/** 从底层错误提取 HTTP 状态码(webdav 库错误带 status,网络错误无) */
function statusOf(err: unknown): number | undefined {
  const e = err as { status?: unknown; response?: { status?: unknown } } | null;
  if (typeof e?.status === "number") return e.status;
  if (typeof e?.response?.status === "number") return e.response.status;
  return undefined;
}

/** 把底层错误归类为统一错误码 */
function classify(err: unknown): WebdavErrorCode {
  const status = statusOf(err);
  if (status !== undefined) {
    if (status === 401 || status === 403) return WebdavErrorCode.AUTHENTICATION;
    if (status === 404) return WebdavErrorCode.NOT_FOUND;
    if (status === 409 || status === 412) return WebdavErrorCode.CONFLICT;
  }
  // 网络层错误(fetch TypeError / 超时)与 DNS 错误
  const name = err instanceof Error ? err.name : "";
  const code = (err as { code?: unknown } | null)?.code;
  if (name === "TypeError" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "ECONNRESET") {
    return WebdavErrorCode.CONNECTION;
  }
  return WebdavErrorCode.UNKNOWN;
}

/** 包装底层错误:已归类错误原样返回,其余转为 WebdavError(消息脱敏) */
export function wrapError(err: unknown, context: string): WebdavError {
  if (err instanceof WebdavError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new WebdavError(classify(err), `${context}: ${sanitizeMessage(message)}`, err);
}
