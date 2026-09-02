/**
 * 绿联 UGOS / OpenList WebDAV 上传 SDK 的公共类型。
 * 字段语义以本文件为权威定义。
 */

/** 网关类型：ugapp（UGOS 应用市场的应用）或 ugdocker（Docker「对外访问」容器） */
export type UgGatewayKind = "ugapp" | "ugdocker";

/** 连接配置：应用网关 + 设备应用 ID + UGOS 账号 */
export interface UgAppConfig {
  /** 应用网关地址：ugapp 形如 app-{proxyId}-{host}.ugapp.link；ugdocker 形如 app-{port}-{host}.ugdocker.link */
  appHost: string;
  /** 应用 ID（ugapp：appHost 里 app- 与 -主机名 之间的那一段；ugdocker：对外访问端口，如 "5244"） */
  proxyId: string;
  /** 网关类型；默认按 appHost 后缀自动识别（.ugdocker.link → ugdocker，其余 → ugapp） */
  kind?: UgGatewayKind;
  /** UGOS 用户名 */
  username: string;
  /** 明文密码（仅本地使用，绝不打印/回传） */
  password: string;
  /** 默认目录（OpenList 虚拟路径），如 /DXP4800GT/AmeChan/下载 */
  baseDir?: string;
  /** 会话 cookie 缓存；不传则用进程内内存缓存 */
  cookieStore?: CookieStore;
  /** 会话 cookie 缓存有效期毫秒，默认 10 分钟；传 0 表示每次重新登录 */
  cookieTtlMs?: number;
  /** 单次请求超时毫秒，默认 30000 */
  timeoutMs?: number;
}

/**
 * cookie 缓存存储接口。SDK 负责 TTL 判定与自动重登，
 * 外部只负责持久化（内存 / sqlite / 文件均可）。
 */
export interface CookieStore {
  /** 读取缓存的会话 cookie 与保存时间（epoch 毫秒）；无缓存返回 null */
  get(): { cookie: string; savedAt: number } | null;
  /** 写入缓存的会话 cookie 与保存时间 */
  set(cookie: string, savedAt: number): void;
  /** 会话失效时清除缓存（可选） */
  clear?(): void;
}

/** 目录条目 */
export interface UgAppEntry {
  name: string;
}

/** 连通性测试结果 */
export type TestResult = { ok: true; entries: string[] } | { ok: false; message: string };

/** 列目录结果 */
export type ListResult = { ok: true; entries: string[] } | { ok: false; message: string };

/** 上传结果 */
export type UploadResult =
  | { ok: true; path: string; status: number }
  | { ok: false; status?: number; error: string };

/** UGOS 客户端接口 */
export interface UgAppClient {
  /** 走完整登录链路拿会话 cookie（带缓存，失效自动重登） */
  acquireCookie(): Promise<string>;
  /** 连通性测试：登录 + PROPFIND 列默认目录 */
  test(): Promise<TestResult>;
  /** 列目录（默认 baseDir） */
  list(dirPath?: string): Promise<ListResult>;
  /** 上传文件到默认目录（302/401 自动重登重试一次） */
  upload(filename: string, content: Buffer | string, options?: { dirPath?: string }): Promise<UploadResult>;
}

