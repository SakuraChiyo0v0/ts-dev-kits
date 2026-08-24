import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDataStore, DataErrorCode } from "../src/index.js";
import type { DataStore } from "../src/index.js";

/**
 * PostgreSQL 真实协议路径测试:仅在设置了 DATABASE_TEST_PG_URL 时运行。
 * 测试建唯一临时表,收尾 DROP 自清理,不影响既有数据。
 */
const url = process.env.DATABASE_TEST_PG_URL;

describe.skipIf(!url)("postgres 适配器(真实协议路径)", () => {
  const table = `dsh_pg_test_${Date.now()}`;
  let store: DataStore;

  beforeAll(async () => {
    store = createDataStore({ dialect: "postgres", url: url! });
    await store.execute(`CREATE TABLE ${table} (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, age INT)`);
  });

  afterAll(async () => {
    await store.execute(`DROP TABLE IF EXISTS ${table}`);
    await store.close();
  });

  it("CRUD 往返,占位符自动转 $n", async () => {
    await store.execute(`INSERT INTO ${table} (name, age) VALUES (?, ?)`, ["alice", 30]);
    const rows = await store.query<{ id: number; name: string; age: number }>(
      `SELECT id, name, age FROM ${table} WHERE age > ?`,
      [18],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "alice", age: 30 });

    const updated = await store.execute(`UPDATE ${table} SET age = ? WHERE name = ?`, [31, "alice"]);
    expect(updated.affectedRows).toBe(1);
  });

  it("单引号字符串内的 ? 不被转换(JSONB 字面量)", async () => {
    await store.execute(`INSERT INTO ${table} (name, age) VALUES (?, ?)`, ["bob", 20]);
    // 该查询的字符串字面量里含 ?,若被误转成 $n 会因参数缺失报错
    const rows = await store.query(`SELECT name FROM ${table} WHERE name = 'bob?' AND age > ?`, [0]);
    expect(rows).toHaveLength(0);
  });

  it("事务抛错自动回滚", async () => {
    await expect(
      store.transaction(async (tx) => {
        await tx.execute(`INSERT INTO ${table} (name, age) VALUES (?, ?)`, ["carol", 22]);
        throw new Error("中途失败");
      }),
    ).rejects.toThrow("中途失败");
    const rows = await store.query<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table} WHERE name = ?`, ["carol"]);
    // PG 的 COUNT(*) 为 int8,驱动默认返回字符串(避免精度丢失),断言时转数字
    expect(Number(rows[0]!.c)).toBe(0);
  });

  it("唯一约束违反 → CONSTRAINT", async () => {
    await store.execute(`INSERT INTO ${table} (name, age) VALUES (?, ?)`, ["dup", 1]);
    await expect(store.execute(`INSERT INTO ${table} (name, age) VALUES (?, ?)`, ["dup", 2])).rejects.toMatchObject({
      code: DataErrorCode.CONSTRAINT,
    });
  });

  it("SQL 语法错误 → QUERY_SYNTAX", async () => {
    await expect(store.query("SELECT FROM")).rejects.toMatchObject({ code: DataErrorCode.QUERY_SYNTAX });
  });

  it("连接失败 → CONNECTION", async () => {
    const bad = createDataStore({ dialect: "postgres", url: "postgresql://127.0.0.1:1/nope" });
    await expect(bad.ping()).rejects.toMatchObject({ code: DataErrorCode.CONNECTION });
    await bad.close();
  });
});
