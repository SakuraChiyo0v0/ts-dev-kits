/** PostgreSQL 配置后端：键值存 PG 表（直接用 node-postgres，避免 config↔database 循环依赖）。 */

import { Pool } from "pg";
import { PrefixBackend, type ConfigBackend } from "./backend.js";

/** PG 键值后端：key → value(JSON 文本)，单表实现。 */
export class PgBackend implements ConfigBackend {
  readonly #pool: Pool;
  readonly #table: string;

  constructor(options: { url: string; table?: string }) {
    this.#pool = new Pool({ connectionString: options.url });
    this.#table = options.table ?? "config_kv";
  }

  /** 初始化建表（幂等）。 */
  async init(): Promise<void> {
    await this.#pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.#table} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    );
  }

  async load<T = unknown>(key: string): Promise<T> {
    const { rows } = await this.#pool.query(
      `SELECT value FROM ${this.#table} WHERE key = $1`,
      [key],
    );
    const raw = rows[0]?.value as string | undefined;
    if (raw === undefined) return undefined as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }

  async save(key: string, value: unknown): Promise<void> {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    await this.#pool.query(
      `INSERT INTO ${this.#table} (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, text],
    );
  }

  async list(): Promise<string[]> {
    const { rows } = await this.#pool.query<{ key: string }>(`SELECT key FROM ${this.#table}`);
    return rows.map((r) => r.key);
  }

  async remove(key: string): Promise<void> {
    await this.#pool.query(`DELETE FROM ${this.#table} WHERE key = $1`, [key]);
  }

  withPrefix(prefix: string): ConfigBackend {
    return new PrefixBackend(this, prefix);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
