export type ConfigErrorCode = "VALIDATION" | "NOT_FOUND";
/** 通用配置错误，不依赖具体存储驱动。 */
export class ConfigError extends Error {
  constructor(readonly code: ConfigErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ConfigError";
  }
}
