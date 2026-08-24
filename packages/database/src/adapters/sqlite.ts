import Database from "better-sqlite3";
import { DataError, DataErrorCode, wrapDbError } from "../errors.js";
import { convertPlaceholders } from "../placeholder.js";
import type { DatabaseAdapter, ExecuteResult, Params, Row, SqliteConfig } from "../types.js";

/**
 * SQLite 适配器:基于 better-sqlite3(同步底层,上层接口仍为 async)。
 * 单连接执行,事务天然串行;busy_timeout 避免并发写时立即抛锁冲突。
 */
export class SqliteAdapter implements DatabaseAdapter {
  readonly dialect = "sqlite" as const;
  private readonly db: Database.Database;

  constructor(config: SqliteConfig) {
    if (config.path.length === 0) {
      throw new DataError(DataErrorCode.CONFIGURATION, "sqlite 配置缺少 path");
    }
    try {
      this.db = new Database(config.path);
    } catch (err) {
      throw wrapDbError(err, "sqlite");
    }
    this.db.pragma("busy_timeout = 5000");
  }

  async all<T extends Row = Row>(sql: string, params: Params): Promise<T[]> {
    try {
      return this.db.prepare(convertPlaceholders(sql, "sqlite")).all(...params) as T[];
    } catch (err) {
      throw wrapDbError(err, "sqlite");
    }
  }

  async run(sql: string, params: Params): Promise<ExecuteResult> {
    try {
      const info = this.db.prepare(convertPlaceholders(sql, "sqlite")).run(...params);
      return { affectedRows: info.changes };
    } catch (err) {
      throw wrapDbError(err, "sqlite");
    }
  }

  async begin(): Promise<void> {
    try {
      this.db.exec("BEGIN");
    } catch (err) {
      throw wrapDbError(err, "sqlite");
    }
  }

  async commit(): Promise<void> {
    try {
      this.db.exec("COMMIT");
    } catch (err) {
      throw wrapDbError(err, "sqlite");
    }
  }

  async rollback(): Promise<void> {
    try {
      this.db.exec("ROLLBACK");
    } catch (err) {
      throw wrapDbError(err, "sqlite");
    }
  }

  async ping(): Promise<void> {
    try {
      this.db.prepare("SELECT 1").get();
    } catch (err) {
      throw wrapDbError(err, "sqlite");
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
