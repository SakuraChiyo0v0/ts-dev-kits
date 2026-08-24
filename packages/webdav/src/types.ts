/**
 * WebDAV 配置存取 SDK 的公共类型。
 * 字段语义以本文件为权威定义。
 */

/** 连接配置:URL + 基本认证(或无认证) */
export interface WebdavConnectionConfig {
  /** WebDAV 根地址,如 https://dav.jianguoyun.com/dav/ */
  url: string;
  username?: string;
  password?: string;
  /** 请求超时毫秒数,默认 15000 */
  timeoutMs?: number;
}

/** 条目类型:文件或目录 */
export type WebdavEntryType = "file" | "directory";

/** 目录列表中的条目 */
export interface WebdavFileStat {
  /** 相对 WebDAV 根的路径,如 /configs/app.json */
  path: string;
  /** 名称,如 app.json */
  name: string;
  type: WebdavEntryType;
  /** 字节数(目录通常为 0) */
  size: number;
  lastModified: Date;
}

/** ConfigStore 选项 */
export interface ConfigStoreOptions {
  /** 远端配置目录,默认 "/configs/" */
  basePath?: string;
  /** 配置格式,默认 json(json 自动序列化/解析) */
  format?: "json" | "text";
  /** 保留历史备份数,默认 3,0=不备份 */
  backupCount?: number;
}

/** 基础 WebDAV 文件操作接口(薄封装 webdav 库,统一错误) */
export interface WebdavClient {
  /** 连通性检查(列出根目录) */
  ping(): Promise<void>;
  /** 列目录,返回条目数组 */
  list(path: string): Promise<WebdavFileStat[]>;
  /** 读文件,返回文本内容 */
  get(path: string): Promise<string>;
  /** 读文件,返回二进制内容(如 zip/图片) */
  getBinary(path: string): Promise<Buffer>;
  /** 写文件;overwrite=false 时目标已存在抛 CONFLICT */
  put(path: string, content: string, options?: { overwrite?: boolean }): Promise<void>;
  /** 写二进制文件(如 zip/图片) */
  putBinary(path: string, content: Buffer, options?: { overwrite?: boolean }): Promise<void>;
  /** 建目录(已存在时报错) */
  mkdir(path: string): Promise<void>;
  /** 删文件或空目录 */
  remove(path: string): Promise<void>;
  /** 移动/重命名(覆盖目标) */
  move(from: string, to: string): Promise<void>;
  /** 复制(覆盖目标) */
  copy(from: string, to: string): Promise<void>;
  /** 判断路径是否存在 */
  exists(path: string): Promise<boolean>;
}

/** 配置文件存储高层 API */
export interface ConfigStore {
  /** 读取并解析配置;不存在抛 NOT_FOUND */
  load<T = unknown>(name: string): Promise<T>;
  /** 原子写(临时文件+move 覆盖),旧版本自动滚动备份 */
  save(name: string, data: unknown): Promise<void>;
  /** 列出 basePath 下所有配置文件 */
  list(): Promise<string[]>;
  /** 删除配置文件 */
  remove(name: string): Promise<void>;
}
