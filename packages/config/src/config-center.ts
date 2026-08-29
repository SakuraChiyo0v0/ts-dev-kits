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
import { PrefixBackend, type ConfigBackend } from "./backend.js";
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

/** 校验命名空间:不允许路径分隔符/越界(防路径穿越) */
function validateNamespace(name: string): void {
  if (!name || name.length === 0) {
    throw new WebdavError(WebdavErrorCode.VALIDATION, "namespace 不能为空");
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new WebdavError(WebdavErrorCode.VALIDATION, `namespace 非法(不允许路径分隔符/越界): ${name}`);
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
      store = createConfigStore({ client, basePath, format: "json" });
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

  constructor(global: GlobalConfig, backend?: ConfigBackend) {
    if (backend !== undefined) {
      this.backend = backend;
      if (global.key !== undefined) this.key = global.key;
    } else {
      if (!global.url || global.url.trim().length === 0) {
        throw new WebdavError(WebdavErrorCode.VALIDATION, "全局配置缺少 webdav url，或需显式传 backend");
      }
      this.url = global.url;
      if (global.key !== undefined) this.key = global.key;
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
    if (encrypt) {
      nsBackend = encryptedBackend(nsBackend, this.key);
    }
    logger.debug("namespace created", { name, encrypt, prefix });
    return new ConfigNamespaceImpl(name, encrypt, nsBackend);
  }
}

/** 创建配置中心:优先显式 backend,否则读本地全局配置(WebDAV) */
export function createConfigCenter(options: ConfigCenterOptions = {}): ConfigCenter {
  const global = options.global ?? loadGlobalConfig(options.configPath);
  return new ConfigCenterImpl(global, options.backend);
}

void PrefixBackend;
