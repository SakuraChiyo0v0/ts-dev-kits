/**
 * 配置中心 SDK 的公共类型。
 * 字段语义以本文件为权威定义。
 */

/** 配置中心只接受显式后端，后端实现由额外适配包提供。 */
export interface ConfigCenterOptions {
  backend: import("./backend.js").ConfigBackend;
  key?: string;
}

/** 命名空间选项 */
export interface NamespaceOptions {
  /** 是否加密存储;默认 true；false 为明文配置 */
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
  /** 创建/获取命名空间(encrypt:true 走加密存储) */
  namespace(name: string, options?: NamespaceOptions): ConfigNamespace;
}
