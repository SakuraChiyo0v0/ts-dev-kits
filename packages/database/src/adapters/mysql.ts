import mysql from "mysql2/promise";
import { createLogger } from "@sakurachiyo0v0/logger";
import { DataError, DataErrorCode, wrapDbError } from "../errors.js";
import { convertPlaceholders } from "../placeholder.js";
import type { DatabaseAdapter, ExecuteResult, Params, Row, MysqlConfig } from "../types.js";

type MysqlResult = mysql.ResultSetHeader | mysql.RowDataPacket[];

const logger = createLogger({ namespace: "database" }).child("mysql");

/** 提取连接串 host 用于日志(不含凭据/路径) */
function logHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(invalid url)";
  }
}

/**
 * MySQL 适配器:基于 mysql2 连接池(server-side prepared statement,防注入)。
 * 事务期间固定使用同一条 PoolConnection;非事务操作直接走 pool。
 */
export class MysqlAdapter implements DatabaseAdapter {
  readonly dialect = "mysql" as const;
  private readonly pool: mysql.Pool;
  private txConn: mysql.PoolConnection | undefined;

  constructor(config: MysqlConfig) {
    try {
      new URL(config.url);
    } catch {
      throw new DataError(DataErrorCode.CONFIGURATION, "mysql url 非法,应为 mysql://user:***@host:3306/db 形式");
    }
    this.pool = mysql.createPool({
      uri: config.url,
      connectionLimit: config.maxConnections ?? 10,
    });
    logger.debug("mysql pool created", {
      host: logHost(config.url),
      maxConnections: config.maxConnections ?? 10,
    });
  }

  private execTarget(): mysql.Pool | mysql.PoolConnection {
    return this.txConn ?? this.pool;
  }

  async all<T extends Row = Row>(sql: string, params: Params): Promise<T[]> {
    try {
      const [rows] = await this.execTarget().execute(convertPlaceholders(sql, "mysql"), params) as [MysqlResult, unknown];
      return Array.isArray(rows) ? (rows as T[]) : [];
    } catch (err) {
      throw wrapDbError(err, "mysql");
    }
  }

  async run(sql: string, params: Params): Promise<ExecuteResult> {
    try {
      const [result] = await this.execTarget().execute(convertPlaceholders(sql, "mysql"), params) as [MysqlResult, unknown];
      if (Array.isArray(result)) return { affectedRows: 0 };
      return { affectedRows: result.affectedRows ?? 0 };
    } catch (err) {
      throw wrapDbError(err, "mysql");
    }
  }

  async begin(): Promise<void> {
    let conn: mysql.PoolConnection;
    try {
      conn = await this.pool.getConnection();
    } catch (err) {
      throw wrapDbError(err, "mysql");
    }
    try {
      await conn.beginTransaction();
    } catch (err) {
      conn.release();
      throw wrapDbError(err, "mysql");
    }
    this.txConn = conn;
  }

  async commit(): Promise<void> {
    const conn = this.txConn;
    if (!conn) return;
    try {
      await conn.commit();
    } catch (err) {
      throw wrapDbError(err, "mysql");
    } finally {
      conn.release();
      this.txConn = undefined;
    }
  }

  async rollback(): Promise<void> {
    const conn = this.txConn;
    if (!conn) return;
    try {
      await conn.rollback();
    } catch (err) {
      throw wrapDbError(err, "mysql");
    } finally {
      conn.release();
      this.txConn = undefined;
    }
  }

  async ping(): Promise<void> {
    try {
      await this.pool.query("SELECT 1");
    } catch (err) {
      throw wrapDbError(err, "mysql");
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
