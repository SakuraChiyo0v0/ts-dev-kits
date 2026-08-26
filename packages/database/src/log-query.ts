/**
 * 日志查询 —— 从本地 SQLite 或远程 PostgreSQL 按条件查询日志。
 *
 * 支持过滤:等级 level / 设备 hostname / 命名空间 namespace / 时间区间 from-to / 关键词 keyword。
 * 查询结果按时间倒序,支持分页(limit/offset)。
 */
import type { LogLevelName } from "@sakurachiyo0v0/logger";
import { createDataStore } from "./store.js";
import type { ParamValue } from "./types.js";

/** 查询返回的单条日志。 */
export interface LogQueryResult {
  id: number | string;
  time: string;
  level: string;
  namespace: string;
  hostname: string;
  message: string;
  /** 序列化的 JSON 字符串(原始 data)。 */
  data?: string | null;
}

/** 日志查询选项。 */
export interface LogQueryOptions {
  /** 本地 SQLite 库路径(查本地);与 remoteUrl 二选一或都传(合并)。 */
  localPath?: string;
  /** 远程 PostgreSQL 连接串(查远程)。 */
  remoteUrl?: string;
  /** 等级过滤(可多个)。 */
  level?: LogLevelName | LogLevelName[];
  /** 设备过滤(hostname 精确匹配;不传=全部设备)。 */
  hostname?: string;
  /** 命名空间过滤(子串匹配)。 */
  namespace?: string;
  /** 起始时间(含)。 */
  from?: string | Date;
  /** 结束时间(含)。 */
  to?: string | Date;
  /** 关键词(在 message/data 里模糊搜索)。 */
  keyword?: string;
  /** 返回条数上限,默认 100。 */
  limit?: number;
  /** 跳过条数(分页),默认 0。 */
  offset?: number;
}

/** 规范化时间值为 ISO 字符串。 */
function toIso(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** 把查询条件转成 SQL 片段 + 参数(sqlite 用 ?,postgres 用 $n,分开处理)。 */
function buildWhere(options: LogQueryOptions): { sql: string; params: ParamValue[] } {
  const clauses: string[] = [];
  const params: ParamValue[] = [];

  const levels = options.level === undefined ? undefined : Array.isArray(options.level) ? options.level : [options.level];
  if (levels !== undefined && levels.length > 0) {
    clauses.push(`level IN (${levels.map(() => "?").join(", ")})`);
    params.push(...levels.map((l) => l.toUpperCase()));
  }
  if (options.hostname !== undefined && options.hostname !== "") {
    clauses.push("hostname = ?");
    params.push(options.hostname);
  }
  if (options.namespace !== undefined && options.namespace !== "") {
    clauses.push("namespace LIKE ?");
    params.push(`%${options.namespace}%`);
  }
  const fromIso = toIso(options.from);
  if (fromIso !== undefined) {
    clauses.push("time >= ?");
    params.push(fromIso);
  }
  const toIso2 = toIso(options.to);
  if (toIso2 !== undefined) {
    clauses.push("time <= ?");
    params.push(toIso2);
  }
  if (options.keyword !== undefined && options.keyword !== "") {
    clauses.push("(message LIKE ? OR CAST(data AS TEXT) LIKE ?)");
    const kw = `%${options.keyword}%`;
    params.push(kw, kw);
  }
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

/** 行 → LogQueryResult(统一处理 PG 的 Date/jsonb 与 SQLite 的字符串)。 */
function toResult(r: Record<string, unknown>): LogQueryResult {
  const time = r.time instanceof Date ? r.time.toISOString() : String(r.time);
  const data =
    r.data === null || r.data === undefined
      ? undefined
      : typeof r.data === "string"
        ? r.data
        : JSON.stringify(r.data);
  return {
    id: r.id as number,
    time,
    level: String(r.level),
    namespace: String(r.namespace),
    hostname: String(r.hostname),
    message: String(r.message),
    ...(data !== undefined ? { data } : {}),
  };
}

/** 查本地 SQLite。 */
async function queryLocal(
  localPath: string,
  options: LogQueryOptions,
): Promise<LogQueryResult[]> {
  // 确保父目录存在(better-sqlite3 不会自动建目录)。
  const { dirname } = await import("node:path");
  const { mkdirSync } = await import("node:fs");
  try {
    mkdirSync(dirname(localPath), { recursive: true });
  } catch {
    // 目录创建失败不阻断(可能只是路径为空)。
  }
  const store = createDataStore({ dialect: "sqlite", path: localPath });
  try {
    const { sql, params } = buildWhere(options);
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const rows = await store.query<Record<string, unknown>>(
      `SELECT id, time, level, namespace, hostname, message, data
       FROM log_entries ${sql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return rows.map(toResult);
  } finally {
    await store.close();
  }
}

/** 查远程 PostgreSQL(把 ? 占位符转 $n)。 */
async function queryRemote(
  remoteUrl: string,
  options: LogQueryOptions,
): Promise<LogQueryResult[]> {
  const store = createDataStore({ dialect: "postgres", url: remoteUrl });
  try {
    const { sql, params } = buildWhere(options);
    // ? → $1/$2/$3...(计数器递增)
    let phIndex = 0;
    const numbered = sql.replace(/\?/g, () => {
      phIndex += 1;
      return `$${phIndex}`;
    });
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const rows = await store.query<Record<string, unknown>>(
      `SELECT id, time, level, namespace, hostname, message, data
       FROM log_entries ${numbered}
       ORDER BY id DESC
       LIMIT $${phIndex + 1} OFFSET $${phIndex + 2}`,
      [...params, limit, offset],
    );
    return rows.map(toResult);
  } finally {
    await store.close();
  }
}

/**
 * 按条件查询日志。
 * - 只传 localPath:查本地 SQLite;
 * - 只传 remoteUrl:查远程 PostgreSQL;
 * - 两者都传:合并(远程优先,本地补足),按时间倒序。
 */
export async function queryLogs(options: LogQueryOptions): Promise<LogQueryResult[]> {
  const results: LogQueryResult[] = [];

  if (options.localPath !== undefined) {
    results.push(...(await queryLocal(options.localPath, options)));
  }
  if (options.remoteUrl !== undefined) {
    results.push(...(await queryRemote(options.remoteUrl, options)));
  }

  // 合并去重(按 id 去重,id 冲突时保留后写入的——远程在后)。
  if (options.localPath !== undefined && options.remoteUrl !== undefined) {
    const seen = new Set<string>();
    return results.filter((r) => {
      const key = `${r.hostname}:${r.time}:${r.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return results;
}
