import { hostname as osHostname } from "node:os";
import { inspect } from "node:util";
import {
  LogLevel,
  type LogLevelName,
  type LogEntry,
  type LogTransport,
  type Logger,
  type LoggerOptions,
  type TimedOptions,
} from "./types.js";

/** 判断返回值是否为 Promise(用于异步函数耗时包装)。 */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

/**
 * 级别名称 → 数值映射
 */
const LEVEL_MAP: Record<LogLevelName, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
  silent: LogLevel.SILENT,
};

/**
 * 数值 → 级别名称映射
 */
const LEVEL_NAMES: Record<number, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
};

/**
 * 解析级别：支持 LogLevel 枚举值或字符串名称
 */
function resolveLevel(level: LogLevel | LogLevelName): LogLevel {
  if (typeof level === "string") {
    return LEVEL_MAP[level] ?? LogLevel.INFO;
  }
  return level;
}

/**
 * Console transport：输出到 stderr。
 * 日志是诊断信息,一律走 stderr——保证 stdout 永远是纯数据(CLI 的 JSON 输出契约不被污染)。
 */
class ConsoleTransport implements LogTransport {
  write(entry: LogEntry): void {
    const prefix = entry.namespace ? `[${entry.namespace}]` : "";
    const host = entry.hostname ? `@${entry.hostname}` : "";
    const time = entry.time.toISOString();
    const levelName = LEVEL_NAMES[entry.level] ?? "UNKNOWN";
    const base = `${prefix}${host} ${time} ${levelName} ${entry.message}`;

    if (entry.error) {
      const errorInfo = {
        message: entry.error.message,
        stack: entry.error.stack,
        ...(entry.data ?? {}),
      };
      process.stderr.write(`${base} ${inspect(errorInfo)}\n`);
    } else if (entry.data && Object.keys(entry.data).length > 0) {
      process.stderr.write(`${base} ${inspect(entry.data)}\n`);
    } else {
      process.stderr.write(`${base}\n`);
    }
  }
}

/**
 * Logger 内部状态
 */
interface LoggerState {
  namespace: string;
  hostname: string;
  level: LogLevel;
  transport: LogTransport;
  bindings?: Record<string, unknown> | undefined;
}

/**
 * Logger 实现
 */
class LoggerImpl implements Logger {
  readonly namespace: string;
  readonly hostname: string;
  readonly level: LogLevel;
  readonly #transport: LogTransport;
  readonly #bindings: Record<string, unknown> | undefined;

  constructor(state: LoggerState) {
    this.namespace = state.namespace;
    this.hostname = state.hostname;
    this.level = state.level;
    this.#transport = state.transport;
    this.#bindings = state.bindings;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.#write(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.#write(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.#write(LogLevel.WARN, message, data);
  }

  error(message: string, data?: Record<string, unknown> | Error): void {
    if (data instanceof Error) {
      this.#write(LogLevel.ERROR, message, undefined, data);
    } else {
      this.#write(LogLevel.ERROR, message, data);
    }
  }

  timed<T>(name: string, fn: () => T, options: TimedOptions = {}): T {
    const logStart = options.logStart ?? true;
    const successLevel: "debug" | "info" = options.level ?? "info";
    const recordName = options.name ?? name;

    if (logStart) {
      this.debug("timed start", { name: recordName });
    }
    const startedAt = Date.now();
    const duration = (): { durationMs: number } => ({ durationMs: Date.now() - startedAt });

    const onSuccess = (value: T): T => {
      if (successLevel === "debug") {
        this.debug("timed done", { name: recordName, ...duration() });
      } else {
        this.info("timed done", { name: recordName, ...duration() });
      }
      return value;
    };
    const onError = (error: unknown): never => {
      this.error("timed failed", { name: recordName, ...duration(), error });
      throw error;
    };

    try {
      const result = fn();
      if (isPromiseLike(result)) {
        return Promise.resolve(result).then(onSuccess, onError) as T;
      }
      return onSuccess(result);
    } catch (error) {
      return onError(error);
    }
  }

  child(bindingsOrNamespace: Record<string, unknown> | string): Logger {
    if (typeof bindingsOrNamespace === "string") {
      const childNamespace = this.namespace
        ? `${this.namespace}:${bindingsOrNamespace}`
        : bindingsOrNamespace;
      return new LoggerImpl({
        namespace: childNamespace,
        hostname: this.hostname,
        level: this.level,
        transport: this.#transport,
        bindings: this.#bindings,
      });
    }

    const mergedBindings = this.#bindings
      ? { ...this.#bindings, ...bindingsOrNamespace }
      : bindingsOrNamespace;
    return new LoggerImpl({
      namespace: this.namespace,
      hostname: this.hostname,
      level: this.level,
      transport: this.#transport,
      bindings: mergedBindings,
    });
  }

  #write(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    error?: Error,
  ): void {
    if (level < this.level) {
      return;
    }

    const mergedData = this.#bindings
      ? { ...this.#bindings, ...data }
      : data;

    const entry: LogEntry = {
      time: new Date(),
      level,
      namespace: this.namespace,
      hostname: this.hostname,
      message,
      data: mergedData,
      error,
    };

    this.#transport.write(entry);
  }
}

/**
 * 创建 logger
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const state: LoggerState = {
    namespace: options.namespace ?? "",
    hostname: options.hostname ?? osHostname(),
    level: options.level !== undefined ? resolveLevel(options.level) : LogLevel.INFO,
    transport: options.transport ?? new ConsoleTransport(),
  };

  return new LoggerImpl(state);
}
