/**
 * 统一数据访问抽象层的公共类型。
 * 字段语义以本文件为权威定义。
 */

/** 支持的数据库方言 */
export type DataDialect = "sqlite" | "postgres" | "mysql";

/** SQLite 配置:本地文件库,path 传 ":memory:" 表示仅内存的临时库 */
export interface SqliteConfig {
  dialect: "sqlite";
  path: string;
}

/** PostgreSQL 配置:远程库,url 形如 postgresql://user:pass@host:5432/db */
export interface PostgresConfig {
  dialect: "postgres";
  url: string;
  /** 连接池上限,默认 10 */
  maxConnections?: number;
}

/** MySQL 配置:远程库,url 形如 mysql://user:pass@host:3306/db */
export interface MysqlConfig {
  dialect: "mysql";
  url: string;
  /** 连接池上限,默认 10 */
  maxConnections?: number;
}

/** 数据源配置:方言 + 该方言的连接参数,互斥联合 */
export type DataStoreConfig = SqliteConfig | PostgresConfig | MysqlConfig;

/** 参数化查询的单个参数值 */
export type ParamValue = string | number | boolean | null | Buffer;

/** 参数化查询的位置参数数组,上层统一按 `?` 占位符顺序传参 */
export type Params = ParamValue[];

/** 查询返回的一行数据 */
export type Row = Record<string, unknown>;

/** execute 的返回结果 */
export interface ExecuteResult {
  /** 受影响的行数(查询语句为 0) */
  affectedRows: number;
}

/**
 * 统一的数据库访问接口。
 * 三种方言(SQLite/PostgreSQL/MySQL)共用同一套方法,切换后端只改配置。
 */
export interface DataStore {
  readonly dialect: DataDialect;

  /** 查询:返回行数组。T 为行类型,默认 Record<string, unknown> */
  query<T extends Row = Row>(sql: string, params?: Params): Promise<T[]>;

  /** 增删改/DDL:返回受影响行数 */
  execute(sql: string, params?: Params): Promise<ExecuteResult>;

  /**
   * 事务:fn 内所有操作在同一事务中执行,成功提交、抛错自动回滚。
   * 不支持嵌套事务,事务内再次调用会抛 TRANSACTION_ACTIVE。
   */
  transaction<T>(fn: (tx: DataStore) => Promise<T>): Promise<T>;

  /** 探活:连接可用返回,否则抛 CONNECTION */
  ping(): Promise<void>;

  /** 释放底层连接/连接池,幂等 */
  close(): Promise<void>;
}

/**
 * 数据库适配器内部契约:新增数据库 = 实现本接口。
 * 事务期间( begin 之后)所有操作必须绑定到同一条连接。
 */
export interface DatabaseAdapter {
  readonly dialect: DataDialect;
  all<T extends Row = Row>(sql: string, params: Params): Promise<T[]>;
  run(sql: string, params: Params): Promise<ExecuteResult>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
