/**
 * 日志持久化 Transport —— 把 @sakurachiyo0v0/logger 的日志写入本地 SQLite 与/或远程 PostgreSQL。
 *
 * 设计:
 *   - write() 是同步接口(Logger 调用),本地 SQLite 即时写;远程入内存队列。
 *   - 后台定时 flush 远程(批量 INSERT 单事务),失败自动重试(队列保序放回)。
 *   - close() 进程退出前调用:停定时器 + 落库残留队列。
 *
 * 放本包而非 logger 包的原因:database 已依赖 logger(打日志),若 logger 再依赖
 * database 会形成循环依赖;日志持久化本质是数据访问,归 database 包职责一致。
 */
import { mkdirSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { join } from "node:path";
import type { LogEntry, LogTransport } from "@sakurachiyo0v0/logger";
import { resolveConfigRoot } from "@sakurachiyo0v0/config";
import { createDataStore } from "./store.js";
import type { DataStore, ParamValue } from "./types.js";

/** 日志级别名(存库用)。 */
const LEVEL_NAME: Record<number, string> = {
  [10]: "DEBUG",
  [20]: "INFO",
  [30]: "WARN",
  [40]: "ERROR",
};

/** 日志库默认目录(配置根权威实现见 @sakurachiyo0v0/config)。 */
export function defaultLogDir(): string {
  return join(resolveConfigRoot(), "amechan", "logs");
}

/** 本地日志库默认路径:<配置根>/amechan/logs/<hostname>.db */
export function defaultLocalLogPath(hostname: string): string {
  return join(defaultLogDir(), `${hostname}.db`);
}

/**
 * 解析远程日志库连接串(不硬编码密码,按优先级):
 *   1. 环境变量 LOG_REMOTE_URL(显式覆盖)
 *   2. config 加密域:createConfigCenter().namespace("logs", { encrypt: true }).get("remote")
 *      → WebDAV /amechan/secrets/logs/remote 加密存储的 { url }
 *   3. 都没有 → undefined(不写远程)
 *
 * config 用动态 import 懒加载,避免 database 静态依赖 config。
 */
export async function resolveLogRemoteUrl(): Promise<string | undefined> {
  const envUrl = process.env.LOG_REMOTE_URL;
  if (envUrl !== undefined && envUrl !== "") {
    return envUrl;
  }
  try {
    // 动态 import 懒加载,避免 database 静态依赖 config(它链上 webdav/cli-utils)。
    const configModule = (await import("@sakurachiyo0v0/config")) as {
      createConfigCenter: () => {
        namespace: (
          name: string,
          options?: { encrypt?: boolean },
        ) => { get: <T>(key: string) => Promise<T> };
      };
    };
    const cc = configModule.createConfigCenter();
    const logsNs = cc.namespace("logs", { encrypt: true });
    const remote = await logsNs.get<{ url?: string }>("remote");
    const url = remote?.url;
    return url !== undefined && url !== "" ? url : undefined;
  } catch {
    return undefined; // 未配置 WebDAV / config 不可用:降级不写远程
  }
}

/** 数据库 Transport 选项。 */
export interface DatabaseLogTransportOptions {
  /** 本地 SQLite 库路径;缺省 <配置根>/amechan/logs/<hostname>.db;传 false 禁用本地。 */
  localPath?: string | false;
  /**
   * 远程 PostgreSQL 连接串。
   * - 传字符串:显式连接串(推荐环境变量,不硬编码)
   * - 传 "auto":从 config 加密域自动解析(WebDAV /amechan/secrets/logs/remote)
   * - 缺省:不写远程(仅本地)
   */
  remoteUrl?: string | "auto";
  /** flush 间隔(毫秒),默认 1000。 */
  flushIntervalMs?: number;
  /** 远程批量大小,默认 200。 */
  remoteBatchSize?: number;
}

/** 日志条目 → 可序列化的 data 字段(JSON 字符串)。 */
function serializeData(entry: LogEntry): string {
  const payload: Record<string, unknown> = { ...(entry.data ?? {}) };
  if (entry.error !== undefined) {
    const err = entry.error as Error & { code?: unknown };
    payload.error = {
      message: err.message,
      stack: err.stack,
      ...(err.code !== undefined ? { code: err.code } : {}),
    };
  }
  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : "{}";
}

/**
 * 日志持久化 Transport:本地 SQLite 即时写 + 远程 PostgreSQL 批量同步。
 * 用法:
 * ```ts
 * import { createLogger } from "@sakurachiyo0v0/logger";
 * import { DatabaseLogTransport } from "@sakurachiyo0v0/database";
 *
 * // 方式一:显式连接串(环境变量,不硬编码)
 * const transport = new DatabaseLogTransport({ remoteUrl: process.env.LOG_REMOTE_URL });
 *
 * // 方式二:从 config 加密域自动解析(WebDAV /amechan/secrets/logs/remote)
 * const transport = await DatabaseLogTransport.fromConfig();
 *
 * const logger = createLogger({ namespace: "bilibili", transport });
 * // 进程退出前:await transport.close();
 * ```
 */
export class DatabaseLogTransport implements LogTransport {
  readonly #localPath: string | false;
  #remoteUrl: string | undefined;
  readonly #flushIntervalMs: number;
  readonly #remoteBatchSize: number;

  #local: DataStore | null = null;
  #remote: DataStore | null = null;
  #queue: LogEntry[] = [];
  #timer: NodeJS.Timeout | null = null;
  #flushing = false;
  #closed = false;

  /**
   * 从 config 加密域自动解析远程连接串并创建 transport。
   * 解析不到远程时不写远程(仅本地),不抛错。
   */
  static async fromConfig(
    options: Omit<DatabaseLogTransportOptions, "remoteUrl"> = {},
  ): Promise<DatabaseLogTransport> {
    const remoteUrl = await resolveLogRemoteUrl();
    return new DatabaseLogTransport({ ...options, ...(remoteUrl !== undefined ? { remoteUrl } : {}) });
  }

  constructor(options: DatabaseLogTransportOptions = {}) {
    this.#localPath =
      options.localPath ?? defaultLocalLogPath(osHostname());
    this.#remoteUrl = options.remoteUrl === "auto" ? undefined : options.remoteUrl;
    this.#flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.#remoteBatchSize = options.remoteBatchSize ?? 200;

    this.#openLocal();
    if (this.#remoteUrl !== undefined) {
      this.#openRemote();
    } else if (options.remoteUrl === "auto") {
      // "auto":异步从 config 加密域解析连接串(解析不到则仅本地)。
      void resolveLogRemoteUrl().then((url) => {
        if (url !== undefined && !this.#closed) {
          this.#remoteUrl = url;
          this.#openRemote();
        }
      });
    }

    this.#timer = setInterval(() => {
      void this.flush();
    }, this.#flushIntervalMs);
    this.#timer.unref();
  }

  /** 打开本地 SQLite(失败降级 stderr,不抛)。 */
  #openLocal(): void {
    if (this.#localPath === false) return;
    try {
      mkdirSync(join(this.#localPath, ".."), { recursive: true });
      const store = createDataStore({ dialect: "sqlite", path: this.#localPath });
      void store
        .execute(
          `CREATE TABLE IF NOT EXISTS log_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time TEXT NOT NULL,
            level TEXT NOT NULL,
            namespace TEXT NOT NULL DEFAULT '',
            hostname TEXT NOT NULL DEFAULT '',
            message TEXT NOT NULL,
            data TEXT
          )`,
        )
        .then(() =>
          Promise.all([
            store.execute("CREATE INDEX IF NOT EXISTS idx_logs_time ON log_entries(time)"),
            store.execute("CREATE INDEX IF NOT EXISTS idx_logs_level ON log_entries(level)"),
            store.execute(
              "CREATE INDEX IF NOT EXISTS idx_logs_hostname ON log_entries(hostname)",
            ),
          ]),
        )
        .catch(() => undefined);
      this.#local = store;
    } catch (error) {
      this.#local = null;
      process.stderr.write(`[logger] 本地日志库打开失败: ${String(error)}\n`);
    }
  }

  /** 打开远程 PostgreSQL(失败降级 stderr,不抛)。 */
  #openRemote(): void {
    try {
      this.#remote = createDataStore({ dialect: "postgres", url: this.#remoteUrl! });
    } catch (error) {
      this.#remote = null;
      process.stderr.write(`[logger] 远程日志库连接失败: ${String(error)}\n`);
    }
  }

  write(entry: LogEntry): void {
    if (this.#closed) return;
    this.#queue.push(entry);
    if (this.#local !== null) {
      this.#writeLocal(entry);
    }
  }

  /** 本地即时写(异步 fire-and-forget,失败降级)。 */
  #writeLocal(entry: LogEntry): void {
    const store = this.#local;
    if (store === null) return;
    const params: ParamValue[] = [
      entry.time.toISOString(),
      LEVEL_NAME[entry.level as number] ?? "UNKNOWN",
      entry.namespace,
      entry.hostname,
      entry.message,
      serializeData(entry),
    ];
    void store
      .execute(
        `INSERT INTO log_entries (time, level, namespace, hostname, message, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
        params,
      )
      .catch((error: unknown) => {
        process.stderr.write(`[logger] 本地日志写入失败: ${String(error)}\n`);
      });
  }

  /** 批量 flush 远程队列。 */
  async flush(): Promise<void> {
    if (this.#flushing || this.#closed) return;
    if (this.#remote === null || this.#queue.length === 0) return;

    this.#flushing = true;
    const batch = this.#queue.splice(0, this.#remoteBatchSize);
    try {
      await this.#insertRemote(batch);
    } catch (error) {
      // 失败:保序放回队首,下次重试。
      this.#queue.unshift(...batch);
      process.stderr.write(
        `[logger] 远程日志同步失败(${batch.length} 条待重试): ${String(error)}\n`,
      );
    } finally {
      this.#flushing = false;
    }
  }

  /** 批量插入远程(单事务)。 */
  async #insertRemote(entries: LogEntry[]): Promise<void> {
    const store = this.#remote;
    if (store === null) return;
    await store.transaction(async (tx) => {
      for (const entry of entries) {
        const params: ParamValue[] = [
          entry.time.toISOString(),
          LEVEL_NAME[entry.level as number] ?? "UNKNOWN",
          entry.namespace,
          entry.hostname,
          entry.message,
          serializeData(entry),
        ];
        await tx.execute(
          `INSERT INTO log_entries (time, level, namespace, hostname, message, data)
           VALUES ($1::timestamptz, $2, $3, $4, $5, $6::jsonb)`,
          params,
        );
      }
    });
  }

  /** 关闭:停定时器 + 落库残留队列 + 关连接。 */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    if (this.#queue.length > 0 && this.#remote !== null) {
      try {
        await this.#insertRemote(this.#queue.splice(0));
      } catch {
        // 退出时尽力而为。
      }
    }
    await this.#local?.close().catch(() => undefined);
    await this.#remote?.close().catch(() => undefined);
  }
}
