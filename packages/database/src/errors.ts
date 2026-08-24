import type { DataDialect } from "./types.js";

/** 统一错误码 */
export enum DataErrorCode {
  /** 配置非法:方言未知、缺必填项、连接串解析失败 */
  CONFIGURATION = "CONFIGURATION",
  /** 连接/认证失败:连不上、密码错误、库不存在 */
  CONNECTION = "CONNECTION",
  /** SQL 语法错误或引用了不存在的对象 */
  QUERY_SYNTAX = "QUERY_SYNTAX",
  /** 约束违反:唯一/外键/非空/检查 */
  CONSTRAINT = "CONSTRAINT",
  /** 嵌套事务:事务内再次调用 transaction() */
  TRANSACTION_ACTIVE = "TRANSACTION_ACTIVE",
  /** 在已关闭的数据源上操作 */
  CLOSED = "CLOSED",
  /** 操作超时(仅远程方言) */
  TIMEOUT = "TIMEOUT",
  /** 其他未归类错误 */
  UNKNOWN = "UNKNOWN",
}

/** 统一错误类型:消息已脱敏(不含连接串/密码),原始错误保留在 cause */
export class DataError extends Error {
  readonly code: DataErrorCode;

  constructor(code: DataErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "DataError";
    this.code = code;
  }
}

/** 脱敏:抹掉连接串里的账号密码与显式的 password= 参数 */
function sanitizeMessage(message: string): string {
  return message
    .replace(/([a-z]+):\/\/[^/\s:@]+:[^@\s/]+@/gi, "$1://***:***@")
    .replace(/(password|passwd|pwd)=([^&\s]+)/gi, "$1=***");
}

/** 把底层驱动错误归类为统一错误码 */
function classify(err: unknown, dialect: DataDialect): DataErrorCode {
  const code = (err as { code?: unknown } | null)?.code;
  const raw = typeof code === "string" ? code : "";

  switch (dialect) {
    case "sqlite": {
      if (raw.startsWith("SQLITE_CONSTRAINT")) return DataErrorCode.CONSTRAINT;
      if (raw === "SQLITE_NOTADB" || raw === "SQLITE_CANTOPEN") return DataErrorCode.CONNECTION;
      if (raw === "SQLITE_ERROR" || raw === "SQLITE_MISUSE") return DataErrorCode.QUERY_SYNTAX;
      return DataErrorCode.UNKNOWN;
    }
    case "postgres": {
      // 连接/认证层错误(含网络层)
      if (
        /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EPIPE)$/.test(raw) ||
        ["28P01", "28000", "3D000", "53300", "08001", "08006", "57P03"].includes(raw)
      ) {
        return DataErrorCode.CONNECTION;
      }
      if (raw === "57014" || raw === "57000") return DataErrorCode.TIMEOUT;
      if (raw.startsWith("23")) return DataErrorCode.CONSTRAINT; // 完整性约束
      if (raw.startsWith("42")) return DataErrorCode.QUERY_SYNTAX; // 语法/未定义对象
      if (raw === "ETIMEDOUT") return DataErrorCode.TIMEOUT;
      return DataErrorCode.UNKNOWN;
    }
    case "mysql": {
      // 连接/认证层错误(含网络层)
      if (
        /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EPIPE|PROTOCOL_CONNECTION_LOST)$/.test(raw) ||
        ["ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "ER_CON_COUNT_ERROR", "ER_TOO_MANY_USER_CONNECTIONS"].includes(raw)
      ) {
        return DataErrorCode.CONNECTION;
      }
      if (/^(ETIMEDOUT|ER_LOCK_WAIT_TIMEOUT|ER_QUERY_INTERRUPTED|ER_STATEMENT_TIMEOUT)$/.test(raw)) {
        return DataErrorCode.TIMEOUT;
      }
      if (
        /^(ER_DUP_ENTRY|ER_NO_REFERENCED_ROW|ER_ROW_IS_REFERENCED|ER_BAD_NULL_ERROR|ER_NO_DEFAULT_FOR_FIELD|ER_CHECK_CONSTRAINT_VIOLATED)$/.test(raw)
      ) {
        return DataErrorCode.CONSTRAINT;
      }
      if (
        /^(ER_PARSE_ERROR|ER_SYNTAX_ERROR|ER_BAD_FIELD_ERROR|ER_NO_SUCH_TABLE|ER_TABLE_EXISTS_ERROR|ER_BAD_TABLE_ERROR|ER_WRONG_NUMBER_OF_COLUMNS_IN_SELECT)$/.test(raw)
      ) {
        return DataErrorCode.QUERY_SYNTAX;
      }
      return DataErrorCode.UNKNOWN;
    }
  }
}

/** 包装底层驱动错误:已归类错误原样返回,其余转为 DataError(消息脱敏) */
export function wrapDbError(err: unknown, dialect: DataDialect): DataError {
  if (err instanceof DataError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new DataError(classify(err, dialect), sanitizeMessage(message), err);
}
