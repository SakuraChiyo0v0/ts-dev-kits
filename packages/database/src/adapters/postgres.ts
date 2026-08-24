import pg from "pg";
import { DataError, DataErrorCode, wrapDbError } from "../errors.js";
import { convertPlaceholders } from "../placeholder.js";
import type { DatabaseAdapter, ExecuteResult, Params, Row, PostgresConfig } from "../types.js";

const { Pool } = pg;
type PgPool = pg.Pool;
type PgPoolClient = pg.PoolClient;

/**
 * PostgreSQL 适配器:基于 pg 连接池。
 * 事务期间固定使用同一条 PoolClient,保证 BEGIN/COMMIT/ROLLBACK 在同一连接上;
 * 非事务操作直接走 pool(自动借还连接)。
 * 上层统一 `?` 占位符在提交前转换为 `$n`。
 */
export class PostgresAdapter implements DatabaseAdapter {
  readonly dialect = "postgres" as const;
  private readonly pool: PgPool;
  private txClient: PgPoolClient | undefined;

  constructor(config: PostgresConfig) {
    try {
      new URL(config.url);
    } catch {
      throw new DataError(DataErrorCode.CONFIGURATION, "postgres url 非法,应为 postgresql://user:***@host:5432/db 形式");
    }
    this.pool = new Pool({ connectionString: config.url, max: config.maxConnections ?? 10 });
  }

  private execTarget(): PgPool | PgPoolClient {
    return this.txClient ?? this.pool;
  }

  async all<T extends Row = Row>(sql: string, params: Params): Promise<T[]> {
    try {
      const result = await this.execTarget().query(convertPlaceholders(sql, "postgres"), params);
      return result.rows as T[];
    } catch (err) {
      throw wrapDbError(err, "postgres");
    }
  }

  async run(sql: string, params: Params): Promise<ExecuteResult> {
    try {
      const result = await this.execTarget().query(convertPlaceholders(sql, "postgres"), params);
      return { affectedRows: result.rowCount ?? 0 };
    } catch (err) {
      throw wrapDbError(err, "postgres");
    }
  }

  async begin(): Promise<void> {
    let client: PgPoolClient;
    try {
      client = await this.pool.connect();
    } catch (err) {
      throw wrapDbError(err, "postgres");
    }
    try {
      await client.query("BEGIN");
    } catch (err) {
      client.release();
      throw wrapDbError(err, "postgres");
    }
    this.txClient = client;
  }

  async commit(): Promise<void> {
    const client = this.txClient;
    if (!client) return;
    try {
      await client.query("COMMIT");
    } catch (err) {
      throw wrapDbError(err, "postgres");
    } finally {
      client.release();
      this.txClient = undefined;
    }
  }

  async rollback(): Promise<void> {
    const client = this.txClient;
    if (!client) return;
    try {
      await client.query("ROLLBACK");
    } catch (err) {
      throw wrapDbError(err, "postgres");
    } finally {
      client.release();
      this.txClient = undefined;
    }
  }

  async ping(): Promise<void> {
    try {
      await this.pool.query("SELECT 1");
    } catch (err) {
      throw wrapDbError(err, "postgres");
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
