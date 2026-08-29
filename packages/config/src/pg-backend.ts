/** PostgreSQL 配置后端：键值存 PG 表（直接用 node-postgres，避免 config↔database 循环依赖）。 */

import { Pool } from "pg";
import { PrefixBackend, type ConfigBackend } from "./backend.js";

/** PG 键值后端：key → value(JSON 文本)，单表实现。 */
export class PgBackend implements ConfigBackend {
  readonly #pool: Pool;
  readonly #table: string;
  #tableReady: Promise<void> | null = null;

  constructor(options: { url: string; table?: string }) {
    this.#pool = new Pool({ connectionString: options.url });
    const table = options.table ?? "config_kv";
    // 表名标识符校验，防 SQL 注入。
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new Error(`非法表名: ${table}`);
    }
    this.#table = table;
  }

  /** 懒建表（幂等，首次操作时确保表存在）。 */
  #ensureTable(): Promise<void> {
    if (this.#tableReady === null) {
      this.#tableReady = this.#pool
        .query(
          `CREATE TABLE IF NOT EXISTS ${this.#table} (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`,
        )
        .then(() => undefined)
        .catch((err) => {
          this.#tableReady = null; // 失败允许重试。
          throw err;
        });
    }
    return this.#tableReady;
  }

  /** 初始化建表（幂等）。 */
  async init(): Promise<void> {
    await this.#ensureTable();
  }

  async load<T = unknown>(key: string): Promise<T> {
    await this.#ensureTable();
    const { rows } = await this.#pool.query(
      `SELECT value FROM ${this.#table} WHERE key = $1`,
      [key],
    );
    const raw = rows[0]?.value as string | undefined;
    if (raw === undefined) {
      // 与 WebDAV 后端行为对齐：缺 key 抛 NOT_FOUND。
      throw new Error("NOT_FOUND");
    }
    return raw as T;
  }

  async save(key: string, value: unknown): Promise<void> {
    await this.#ensureTable();
    // 字符串透明：原样存（JSON 序列化由上层 JsonBackend/EncryptedBackend 负责）。
    const text = typeof value === "string" ? value : JSON.stringify(value);
    await this.#pool.query(
      `INSERT INTO ${this.#table} (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, text],
    );
  }

  async list(): Promise<string[]> {
    await this.#ensureTable();
    const { rows } = await this.#pool.query<{ key: string }>(`SELECT key FROM ${this.#table}`);
    return rows.map((r) => r.key);
  }

  async remove(key: string): Promise<void> {
    await this.#ensureTable();
    await this.#pool.query(`DELETE FROM ${this.#table} WHERE key = $1`, [key]);
  }

  withPrefix(prefix: string): ConfigBackend {
    return new PrefixBackend(this, prefix);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
