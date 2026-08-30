/**
 * 配置中心：全局配置一次，namespace 自动映射到统一基底下的分域。
 * 底层存储可插拔（ConfigBackend）：
 *   - 传 backend（如 PgBackend）→ 直接使用；
 *   - 不传 → 读本地全局配置，走 WebDAV（兼容既有部署）。
 * 加密由 EncryptedBackend 包装器负责（不再依赖 webdav 的加密存储）。
 */
import {
  createConfigStore,
  createWebdavClient,
  WebdavError,
  WebdavErrorCode,
  type ConfigStore,
} from "@sakurachiyo0v0/webdav";
import { createLogger } from "@sakurachiyo0v0/logger";
import { loadGlobalConfig } from "./global-config.js";
import { JsonBackend, type ConfigBackend } from "./backend.js";
import { encryptedBackend } from "./encrypt.js";
import type { ConfigCenter, ConfigCenterOptions, ConfigNamespace, GlobalConfig, NamespaceOptions } from "./types.js";

const logger = createLogger({ namespace: "config" }).child("config-center");

/** 提取 URL 的 host 部分用于日志(不含凭据/路径,防 user:pass@ 泄露) */
function logHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(invalid url)";
  }
}

/** 校验命名空间:不允许路径分隔符/冒号/越界(防路径穿越与前后端语义分叉) */
function validateNamespace(name: string): void {
  if (!name || name.length === 0) {
    throw new WebdavError(WebdavErrorCode.VALIDATION, "namespace 不能为空");
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..") || name.includes(":")) {
    throw new WebdavError(WebdavErrorCode.VALIDATION, `namespace 非法(不允许路径分隔符/冒号/越界): ${name}`);
  }
}

/** 统一基底前缀:所有配置挂在该前缀下,避免与仓库内其他应用撞名 */
export const AMECHAN_BASE = "amechan";

/** 把 webdav ConfigStore 适配成 ConfigBackend（prefix 用路径语义）。 */
function createWebdavBackend(global: GlobalConfig): ConfigBackend {
  const client = createWebdavClient({
    url: global.url,
    ...(global.username !== undefined ? { username: global.username } : {}),
    ...(global.password !== undefined ? { password: global.password } : {}),
  });
  const cache = new Map<string, ConfigStore>();
  const makeStore = (basePath: string): ConfigStore => {
    let store = cache.get(basePath);
    if (store === undefined) {
      // format: "text" —— 字符串透明，与加密域旧密文（纯文本）兼容；
      // JSON 序列化统一由上层 JsonBackend/EncryptedBackend 负责。
      store = createConfigStore({ client, basePath, format: "text" });
      cache.set(basePath, store);
    }
    return store;
  };
  const api = (basePath: string): ConfigBackend => ({
    load: (key) => makeStore(basePath).load(key),
    save: (key, value) => makeStore(basePath).save(key, value),
    list: () => makeStore(basePath).list(),
    remove: (key) => makeStore(basePath).remove(key),
    withPrefix(prefix) {
      // WebDAV 是路径语义：把统一前缀的 ":" 转成 "/"。
      const next = prefix.replace(/:/g, "/");
      const joined = basePath === "/" ? `/${next}` : `${basePath}/${next}`;
      return api(joined);
    },
  });
  return api("/");
}

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
  readonly url?: string;
  private readonly backend: ConfigBackend;
  private readonly key?: string;

  constructor(options: ConfigCenterOptions) {
    // 加密密钥正交于后端：顶层 key 优先，回退 global.key（WebDAV 场景）。
    const key = options.key ?? options.global?.key;
    if (options.backend !== undefined) {
      this.backend = options.backend;
      if (key !== undefined) this.key = key;
      logger.debug("config center created (explicit backend)");
    } else {
      const global = options.global;
      if (global === undefined || global.url === undefined || global.url.trim() === "") {
        throw new WebdavError(
          WebdavErrorCode.VALIDATION,
          "未指定存储后端：请显式传入 backend 或 global.url，或先调用 initConfig()",
        );
      }
      this.url = global.url;
      if (key !== undefined) this.key = key;
      this.backend = createWebdavBackend(global);
      logger.debug("config center created (webdav)", { host: logHost(global.url) });
    }
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
 * 创建配置中心：显式 backend（PG 等）或显式 global.url（WebDAV）。
 * 不再自动读本地全局配置——存储方式必须由上游显式指定（或先 initConfig）。
 */
export function createConfigCenter(options: ConfigCenterOptions = {}): ConfigCenter {
  return new ConfigCenterImpl(options);
}

/** 读取本地全局配置（WebDAV 连接信息）并创建配置中心 —— 显式工厂，供 CLI / 需要本地全局配置的场景使用。 */
export function createWebdavConfigCenter(configPath?: string): ConfigCenter {
  const global = loadGlobalConfig(configPath);
  return new ConfigCenterImpl({ global });
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
    throw new WebdavError(
      WebdavErrorCode.VALIDATION,
      "config 未初始化：请先 initConfig() 或显式传入 options",
    );
  }
  return defaultCenter;
}

/** 重置进程级默认配置中心（测试隔离用）。 */
export function resetConfig(): void {
  defaultCenter = null;
}
