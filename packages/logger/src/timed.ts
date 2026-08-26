/**
 * @timed 装饰器 —— 兼容 TS legacy(experimentalDecorators)与 ECMAScript 标准两种签名。
 *
 * 自动为类方法记录耗时:
 *   - 开始:debug "timed start" { name }
 *   - 成功:info "timed done" { name, durationMs }
 *   - 失败:error "timed failed" { name, durationMs, error },随后原样重新抛出
 *
 * 同步与异步方法均支持(返回 Promise 时在 resolve/reject 后计时)。
 *
 * 用法:
 * ```ts
 * class Downloader {
 *   readonly logger = createLogger({ namespace: "bilibili" });
 *
 *   @timed()                                     // 默认取 this.logger,名为 "Downloader.download"
 *   async download(id: string): Promise<void> { ... }
 *
 *   @timed({ name: "merge", logger: myLogger }) // 显式覆盖名与 logger
 *   merge(): void { ... }
 * }
 * ```
 *
 * logger 解析优先级:options.logger > this.logger(约定属性) > 默认 logger(namespace "timed")。
 */
import { createLogger } from "./logger.js";
import type { Logger } from "./types.js";

/** @timed 装饰器选项。 */
export interface TimedOptions {
  /** 显式指定 logger;缺省取实例的 `this.logger`,再缺省用 namespace "timed" 的默认 logger。 */
  logger?: Logger;
  /** 覆盖记录名;缺省为 "<类名>.<方法名>"。 */
  name?: string;
  /** 成功日志级别,默认 "info"(debug/info)。 */
  level?: "debug" | "info";
  /** 是否也记录开始日志,默认 true。 */
  logStart?: boolean;
}

/** 默认 logger:装饰器在无可用 logger 时的兜底(不应在实际使用中触发)。 */
const fallbackLogger = createLogger({ namespace: "timed" });

/** 从实例/选项解析 logger。 */
function resolveLogger<T>(instance: T, options: TimedOptions): Logger {
  if (options.logger !== undefined) {
    return options.logger;
  }
  const candidate = (instance as { logger?: unknown }).logger;
  if (candidate !== undefined && typeof (candidate as Logger).debug === "function") {
    return candidate as Logger;
  }
  return fallbackLogger;
}

/** 判断返回值是否为 Promise(用于异步方法计时)。 */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

/** 包装方法的核心逻辑(两种装饰器签名共用)。 */
function wrapMethod(
  originalMethod: (this: unknown, ...args: unknown[]) => unknown,
  methodName: string,
  options: TimedOptions,
): (this: unknown, ...args: unknown[]) => unknown {
  const logStart = options.logStart ?? true;
  const successLevel: "debug" | "info" = options.level ?? "info";

  return function replaceMethod(this: unknown, ...args: unknown[]): unknown {
    const logger = resolveLogger(this, options);
    const name =
      options.name ??
      `${this !== null && this !== undefined ? this.constructor.name : ""}.${methodName}`;

    if (logStart) {
      logger.debug("timed start", { name });
    }
    const startedAt = Date.now();
    const duration = (): { durationMs: number } => ({ durationMs: Date.now() - startedAt });

    const onSuccess = (value: unknown): unknown => {
      if (successLevel === "debug") {
        logger.debug("timed done", { name, ...duration() });
      } else {
        logger.info("timed done", { name, ...duration() });
      }
      return value;
    };
    const onError = (error: unknown): never => {
      logger.error("timed failed", { name, ...duration(), error });
      throw error;
    };

    try {
      const result = originalMethod.apply(this, args);
      if (isPromiseLike(result)) {
        return Promise.resolve(result).then(onSuccess, onError);
      }
      return onSuccess(result);
    } catch (error) {
      return onError(error);
    }
  };
}

/**
 * 方法耗时装饰器 —— legacy 模式(experimentalDecorators: true)下的签名。
 */
export function timed<Args extends unknown[], Return>(
  options?: TimedOptions,
): (
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<(...args: Args) => Return>,
) => TypedPropertyDescriptor<(...args: Args) => Return> | void;

/**
 * 方法耗时装饰器 —— 标准模式(ECMAScript 2023)下的签名。
 */
export function timed<This, Args extends unknown[], Return>(
  options?: TimedOptions,
): (
  originalMethod: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) => (this: This, ...args: Args) => Return;

/**
 * 方法耗时装饰器实现 —— 运行时检测调用形态:
 *   - 标准装饰器:(value, context),context.kind === "method"
 *   - legacy 装饰器(experimentalDecorators):(target, key, descriptor)
 */
export function timed(options: TimedOptions = {}): any {
  return function timedDecorator(...args: unknown[]): unknown {
    // 标准装饰器:(originalMethod, context)
    if (args.length === 2 && args[1] !== null && typeof args[1] === "object" && "kind" in args[1]) {
      const context = args[1] as { kind?: string; name?: string | symbol };
      if (context.kind !== "method") {
        throw new TypeError(`@timed can only be applied to methods, got "${context.kind}"`);
      }
      const originalMethod = args[0] as (this: unknown, ...args: unknown[]) => unknown;
      return wrapMethod(originalMethod, String(context.name ?? ""), options);
    }

    // legacy 装饰器:(target, propertyKey, descriptor)
    if (args.length === 3) {
      const propertyKey = args[1] as string | symbol;
      const descriptor = args[2] as
        | { value?: unknown; get?: unknown; set?: unknown }
        | undefined;
      if (descriptor === undefined || typeof descriptor.value !== "function") {
        throw new TypeError("@timed can only be applied to methods");
      }
      const originalMethod = descriptor.value as (this: unknown, ...args: unknown[]) => unknown;
      descriptor.value = wrapMethod(originalMethod, String(propertyKey), options);
      return descriptor;
    }

    throw new TypeError("@timed received unexpected decorator arguments");
  };
}
