import { MysqlAdapter } from "./adapters/mysql.js";
import { PostgresAdapter } from "./adapters/postgres.js";
import { SqliteAdapter } from "./adapters/sqlite.js";
import { DataError, DataErrorCode } from "./errors.js";
import type { DataStore, DataStoreConfig, DatabaseAdapter, DataDialect, ExecuteResult, Params, Row } from "./types.js";

/** DataStore 公共实现:统一持有适配器,维护事务/关闭状态,业务与方言无关 */
export class DataStoreImpl implements DataStore {
  readonly dialect: DataDialect;
  private readonly adapter: DatabaseAdapter;
  private txActive = false;
  private closed = false;

  constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
    this.dialect = adapter.dialect;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new DataError(DataErrorCode.CLOSED, `数据源已关闭(${this.dialect}),不能继续操作`);
    }
  }

  async query<T extends Row = Row>(sql: string, params: Params = []): Promise<T[]> {
    this.assertOpen();
    return this.adapter.all<T>(sql, params);
  }

  async execute(sql: string, params: Params = []): Promise<ExecuteResult> {
    this.assertOpen();
    return this.adapter.run(sql, params);
  }

  async transaction<T>(fn: (tx: DataStore) => Promise<T>): Promise<T> {
    this.assertOpen();
    if (this.txActive) {
      throw new DataError(DataErrorCode.TRANSACTION_ACTIVE, "不支持嵌套事务:请先完成当前事务再开启新事务");
    }
    this.txActive = true;
    try {
      await this.adapter.begin();
      const result = await fn(this);
      await this.adapter.commit();
      return result;
    } catch (err) {
      // 回滚失败不掩盖原始错误;begin 失败时适配器 rollback 为幂等空操作
      await this.adapter.rollback().catch(() => undefined);
      throw err;
    } finally {
      this.txActive = false;
    }
  }

  async ping(): Promise<void> {
    this.assertOpen();
    await this.adapter.ping();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.adapter.close();
  }
}

/** 按配置创建统一数据源:SQLite(本地)/ PostgreSQL / MySQL(远程) */
export function createDataStore(config: DataStoreConfig): DataStore {
  switch (config.dialect) {
    case "sqlite":
      return new DataStoreImpl(new SqliteAdapter(config));
    case "postgres":
      return new DataStoreImpl(new PostgresAdapter(config));
    case "mysql":
      return new DataStoreImpl(new MysqlAdapter(config));
    default:
      // 穷尽联合后不可达,防御未知方言
      throw new DataError(DataErrorCode.CONFIGURATION, `未知数据库方言`);
  }
}
