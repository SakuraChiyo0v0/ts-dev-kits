/**
 * 配置中心 SDK 的公共类型。
 * 字段语义以本文件为权威定义。
 */

/** 本地全局配置(chmod600):WebDAV 连接 + 加密密钥(密钥本地保管,不出本机) */
export interface GlobalConfig {
  /** WebDAV 根地址,如 https://dav.jianguoyun.com/dav/ */
  url: string;
  username?: string;
  password?: string;
  /** 加密密钥(可省略,用环境变量 WEBDAV_CONFIG_KEY) */
  key?: string;
}

/** 配置中心创建选项 */
export interface ConfigCenterOptions {
  /** 全局配置文件路径(默认 <配置根>/amechan/config.json,可用 AME_CONFIG_PATH 覆盖) */
  configPath?: string;
  /** 显式传入全局配置(不读文件) */
  global?: GlobalConfig;
  /** 显式传入存储后端(如 PgBackend);不传则读全局配置走 WebDAV(兼容既有部署) */
  backend?: import("./backend.js").ConfigBackend;
}

/** 命名空间选项 */
export interface NamespaceOptions {
  /** 是否加密存储;默认 false(普通配置),true=加密(敏感配置) */
  encrypt?: boolean;
}

/** 配置命名空间:平台/模块的配置域,路径自动隔离 */
export interface ConfigNamespace {
  readonly name: string;
  readonly encrypt: boolean;
  /** 读取配置(不存在抛 NOT_FOUND) */
  get<T = unknown>(key: string): Promise<T>;
  /** 写入配置(原子写 + 自动备份;加密域自动加密) */
  set(key: string, data: unknown): Promise<void>;
  /** 列出该域下所有配置名 */
  list(): Promise<string[]>;
  /** 删除配置 */
  remove(key: string): Promise<void>;
}

/** 配置中心:全局配置一次,按命名空间存取各平台配置 */
export interface ConfigCenter {
  /** WebDAV 根地址(仅 WebDAV 后端时存在) */
  readonly url?: string;
  /** 创建/获取命名空间(encrypt:true 走加密存储) */
  namespace(name: string, options?: NamespaceOptions): ConfigNamespace;
}
