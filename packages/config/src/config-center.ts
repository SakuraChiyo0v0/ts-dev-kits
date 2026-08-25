import {
  createConfigStore,
  createEncryptedConfigStore,
  createWebdavClient,
  WebdavError,
  WebdavErrorCode,
  type ConfigStore,
  type WebdavClient,
} from "@sakurachiyo0v0/webdav";
import { loadGlobalConfig } from "./global-config.js";
import type { ConfigCenter, ConfigCenterOptions, ConfigNamespace, GlobalConfig, NamespaceOptions } from "./types.js";

/** 校验命名空间:不允许路径分隔符/越界(防路径穿越) */
function validateNamespace(name: string): void {
  if (!name || name.length === 0) {
    throw new WebdavError(WebdavErrorCode.VALIDATION, "namespace 不能为空");
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new WebdavError(WebdavErrorCode.VALIDATION, `namespace 非法(不允许路径分隔符/越界): ${name}`);
  }
}

/** 统一基底前缀:所有配置挂在该目录下,避免与仓库内其他应用撞名 */
export const AMECHAN_BASE = "/amechan";

/** 配置命名空间实现:包装 ConfigStore / EncryptedConfigStore */
export class ConfigNamespaceImpl implements ConfigNamespace {
  readonly name: string;
  readonly encrypt: boolean;
  private readonly store: ConfigStore;

  constructor(name: string, encrypt: boolean, store: ConfigStore) {
    this.name = name;
    this.encrypt = encrypt;
    this.store = store;
  }

  get<T = unknown>(key: string): Promise<T> {
    return this.store.load<T>(key);
  }

  set(key: string, data: unknown): Promise<void> {
    return this.store.save(key, data);
  }

  list(): Promise<string[]> {
    return this.store.list();
  }

  remove(key: string): Promise<void> {
    return this.store.remove(key);
  }
}

/** 配置中心实现:全局配置一次,namespace 自动映射到统一基底下的分域 */
export class ConfigCenterImpl implements ConfigCenter {
  readonly url: string;
  private readonly client: WebdavClient;
  private readonly key?: string;

  constructor(global: GlobalConfig) {
    if (!global.url || global.url.trim().length === 0) {
      throw new WebdavError(WebdavErrorCode.VALIDATION, "全局配置缺少 webdav url");
    }
    this.url = global.url;
    if (global.key !== undefined) this.key = global.key;
    this.client = createWebdavClient({
      url: global.url,
      ...(global.username !== undefined ? { username: global.username } : {}),
      ...(global.password !== undefined ? { password: global.password } : {}),
    });
  }

  namespace(name: string, options: NamespaceOptions = {}): ConfigNamespace {
    validateNamespace(name);
    const encrypt = options.encrypt ?? false;
    // 统一基底 /amechan 下按敏感度分域:明文 /amechan/configs/<ns>,加密 /amechan/secrets/<ns>
    const basePath = encrypt ? `${AMECHAN_BASE}/secrets/${name}` : `${AMECHAN_BASE}/configs/${name}`;
    const store: ConfigStore = encrypt
      ? createEncryptedConfigStore({
          client: this.client,
          basePath,
          ...(this.key !== undefined ? { key: this.key } : {}),
        })
      : createConfigStore({ client: this.client, basePath });
    return new ConfigNamespaceImpl(name, encrypt, store);
  }
}

/** 创建配置中心:读本地全局配置(或显式传入) */
export function createConfigCenter(options: ConfigCenterOptions = {}): ConfigCenter {
  const global = options.global ?? loadGlobalConfig(options.configPath);
  return new ConfigCenterImpl(global);
}
