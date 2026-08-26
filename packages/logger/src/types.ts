/**
 * 日志级别定义（数值越大级别越高）
 */
export enum LogLevel {
  DEBUG = 10,
  INFO = 20,
  WARN = 30,
  ERROR = 40,
  SILENT = Infinity,
}

/**
 * 日志级别名称
 */
export type LogLevelName = "debug" | "info" | "warn" | "error" | "silent";

/**
 * 日志条目
 */
export interface LogEntry {
  /** 时间戳 */
  time: Date;
  /** 日志级别 */
  level: LogLevel;
  /** 命名空间路径（如 "bilibili:download"） */
  namespace: string;
  /** 主机名（自动检测或手动指定） */
  hostname: string;
  /** 日志消息 */
  message: string;
  /** 附加数据 */
  data?: Record<string, unknown> | undefined;
  /** Error 对象（自动序列化） */
  error?: Error | undefined;
}

/**
 * Transport 接口：自定义日志输出目标
 */
export interface LogTransport {
  /** 输出一条日志 */
  write(entry: LogEntry): void;
  /** 刷新缓冲区（可选） */
  flush?(): void;
}

/**
 * Logger 配置
 */
export interface LoggerOptions {
  /** 命名空间标识（如 "bilibili"） */
  namespace?: string | undefined;
  /** 最低日志级别，默认 INFO */
  level?: LogLevel | LogLevelName | undefined;
  /** 主机名标识（默认自动检测 os.hostname()） */
  hostname?: string | undefined;
  /** 自定义 transport，默认 console */
  transport?: LogTransport | undefined;
}

/**
 * Logger 接口
 */
export interface Logger {
  /** 当前命名空间 */
  readonly namespace: string;
  /** 当前级别 */
  readonly level: LogLevel;

  /** 输出 debug 级别日志 */
  debug(message: string, data?: Record<string, unknown>): void;
  /** 输出 info 级别日志 */
  info(message: string, data?: Record<string, unknown>): void;
  /** 输出 warn 级别日志 */
  warn(message: string, data?: Record<string, unknown>): void;
  /** 输出 error 级别日志 */
  error(message: string, data?: Record<string, unknown> | Error): void;

  /** 派生子 logger，自动追加命名空间前缀 */
  child(bindings: Record<string, unknown>): Logger;
  /** 派生命名空间子 logger */
  child(namespace: string): Logger;
}
