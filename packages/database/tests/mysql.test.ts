import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDataStore, DataErrorCode } from "../src/index.js";
import type { DataStore } from "../src/index.js";

/**
 * MySQL 真实协议路径测试:仅在设置了 DATABASE_TEST_MYSQL_URL 时运行。
 * 测试建唯一临时表,收尾 DROP 自清理,不影响既有数据。
 */
const url = process.env.DATABASE_TEST_MYSQL_URL;

describe.skipIf(!url)("mysql 适配器(真实协议路径)", () => {
  const table = `dsh_mysql_test_${Date.now()}`;
  let store: DataStore;

  beforeAll(async () => {
    store = createDataStore({ dialect: "mysql", url: url! });
    await store.execute(`CREATE TABLE ${table} (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64) NOT NULL UNIQUE, age INT)`);
  });

  afterAll(async () => {
    await store.execute(`DROP TABLE IF EXISTS ${table}`);
    await store.close();
  });

  it("CRUD 往返", async () => {
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

  it("事务抛错自动回滚", async () => {
    await expect(
      store.transaction(async (tx) => {
        await tx.execute(`INSERT INTO ${table} (name, age) VALUES (?, ?)`, ["carol", 22]);
        throw new Error("中途失败");
      }),
    ).rejects.toThrow("中途失败");
    const rows = await store.query<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table} WHERE name = ?`, ["carol"]);
    expect(rows[0]!.c).toBe(0);
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
    const bad = createDataStore({ dialect: "mysql", url: "mysql://127.0.0.1:1/nope" });
    await expect(bad.ping()).rejects.toMatchObject({ code: DataErrorCode.CONNECTION });
    await bad.close();
  });
});
