/** 统一错误码 */
export enum UgAppErrorCode {
  /** 登录链路失败（预检 / 登录 / 一次性令牌 / 网关认证任一步） */
  LOGIN = "LOGIN",
  /** 认证失败（401/403，目录无权限等） */
  AUTHENTICATION = "AUTHENTICATION",
  /** 网络 / 连接失败、超时 */
  CONNECTION = "CONNECTION",
  /** 参数非法（配置缺失、路径非法） */
  VALIDATION = "VALIDATION",
  /** 其他未归类错误 */
  UNKNOWN = "UNKNOWN",
}

/** 统一错误类型：消息已脱敏（不泄露密码 / token），原始错误保留在 cause */
export class UgAppError extends Error {
  readonly code: UgAppErrorCode;

  constructor(code: UgAppErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "UgAppError";
    this.code = code;
  }
}

/** 脱敏：抹掉 URL 里的账号密码、显式 password=/token= 参数与 Authorization 头 */
function sanitizeMessage(message: string): string {
  return message
    .replace(/([a-z]+):\/\/[^/\s:@]+:[^@\s/]+@/gi, "$1://***:***@")
    .replace(/(password|passwd|pwd|token)=([^&\s]+)/gi, "$1=***")
    .replace(/Basic [A-Za-z0-9+/=]+/gi, "Basic ***");
}

/** 从底层错误提取 HTTP 状态码（网络错误无） */
function statusOf(err: unknown): number | undefined {
  const e = err as { status?: unknown; response?: { status?: unknown } } | null;
  if (typeof e?.status === "number") return e.status;
  if (typeof e?.response?.status === "number") return e.response.status;
  return undefined;
}

/** 把底层错误归类为统一错误码 */
function classify(err: unknown): UgAppErrorCode {
  const status = statusOf(err);
  if (status !== undefined) {
    if (status === 401 || status === 403) return UgAppErrorCode.AUTHENTICATION;
  }
  const name = err instanceof Error ? err.name : "";
  const code = (err as { code?: unknown } | null)?.code;
  if (name === "TypeError" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "ECONNRESET") {
    return UgAppErrorCode.CONNECTION;
  }
  return UgAppErrorCode.UNKNOWN;
}

/** 包装底层错误：已归类错误原样返回，其余转为 UgAppError（消息脱敏） */
export function wrapError(err: unknown, context: string): UgAppError {
  if (err instanceof UgAppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new UgAppError(classify(err), `${context}: ${sanitizeMessage(message)}`, err);
}
