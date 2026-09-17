import { createLogger } from "@sakurachiyo0v0/logger";
import { ConfigError } from "./errors.js";
import { JsonBackend, type ConfigBackend } from "./backend.js";
import { encryptedBackend } from "./encrypt.js";
import type { ConfigCenter, ConfigCenterOptions, ConfigNamespace, NamespaceOptions } from "./types.js";
const logger = createLogger({ namespace: "config" }).child("config-center");

/** 校验命名空间:不允许路径分隔符/冒号/越界(防路径穿越与前后端语义分叉) */
function validateNamespace(name: string): void {
  if (!name || name.length === 0) {
    throw new ConfigError("VALIDATION", "namespace 不能为空");
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..") || name.includes(":")) {
    throw new ConfigError("VALIDATION", `namespace 非法(不允许路径分隔符/冒号/越界): ${name}`);
  }
}

/** 统一基底前缀:所有配置挂在该前缀下,避免与仓库内其他应用撞名 */
export const AMECHAN_BASE = "amechan";

/** 配置命名空间实现:包装 ConfigBackend(可选已加密) */
export class ConfigNamespaceImpl implements ConfigNamespace {
  readonly name: string;
  readonly encrypt: boolean;
  private readonly backend: ConfigBackend;

  constructor(name: string, encrypt: boolean, backend: ConfigBackend) {
    this.name = name;
    this.encrypt = encrypt;
    this.backend = backend;
  }

  get<T = unknown>(key: string): Promise<T> {
    return this.backend.load<T>(key);
  }

  set(key: string, data: unknown): Promise<void> {
    return this.backend.save(key, data);
  }

  list(): Promise<string[]> {
    return this.backend.list();
  }

  remove(key: string): Promise<void> {
    return this.backend.remove(key);
  }
}

/** 配置中心实现 */
export class ConfigCenterImpl implements ConfigCenter {
  private readonly backend: ConfigBackend;
  private readonly key?: string;

  constructor(options: ConfigCenterOptions) {
    if (!options?.backend) throw new ConfigError("VALIDATION", "请显式传入 backend");
    this.backend = options.backend;
    if (options.key !== undefined) this.key = options.key;
  }

  namespace(name: string, options: NamespaceOptions = {}): ConfigNamespace {
    validateNamespace(name);
    const encrypt = options.encrypt ?? true;
    // 统一前缀下按敏感度分域:明文 configs/<ns>,加密 secrets/<ns>
    const prefix = `${AMECHAN_BASE}:${encrypt ? "secrets" : "configs"}:${name}`;
    let nsBackend = this.backend.withPrefix(prefix);
    // 加密域 → EncryptedBackend；明文域 → JsonBackend（JSON 序列化统一在上层）。
    nsBackend = encrypt ? encryptedBackend(nsBackend, this.key) : new JsonBackend(nsBackend);
    logger.debug("namespace created", { name, encrypt, prefix });
    return new ConfigNamespaceImpl(name, encrypt, nsBackend);
  }
}

/** 进程级默认配置中心：initConfig 设定，config() 读取；测试用 resetConfig 重置。 */
let defaultCenter: ConfigCenter | null = null;

/**
 * 创建配置中心：显式传入存储后端。
 * 不再自动读本地全局配置——存储方式必须由上游显式指定（或先 initConfig）。
 */
export function createConfigCenter(options: ConfigCenterOptions): ConfigCenter {
  return new ConfigCenterImpl(options);
}

/** 初始化进程级默认配置中心（组合根入口调用一次）。返回该 center 便于入口直接使用。 */
export function initConfig(options: ConfigCenterOptions): ConfigCenter {
  const center = createConfigCenter(options);
  defaultCenter = center;
  return center;
}

/** 获取配置中心：显式传 options 走覆盖路径（新建）；无参走 initConfig 设定的默认。 */
export function config(options?: ConfigCenterOptions): ConfigCenter {
  if (options !== undefined) {
    return createConfigCenter(options);
  }
  if (defaultCenter === null) {
    throw new ConfigError(
      "VALIDATION",
      "config 未初始化：请先 initConfig() 或显式传入 options",
    );
  }
  return defaultCenter;
}

/** 重置进程级默认配置中心（测试隔离用）。 */
export function resetConfig(): void {
  defaultCenter = null;
}
