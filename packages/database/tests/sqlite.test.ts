import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDataStore, DataError, DataErrorCode } from "../src/index.js";
import type { DataStore } from "../src/index.js";

describe("sqlite 适配器(真实协议路径,:memory:)", () => {
  let store: DataStore;

  beforeEach(async () => {
    store = createDataStore({ dialect: "sqlite", path: ":memory:" });
    await store.execute("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, age INTEGER, avatar BLOB)");
  });

  afterEach(async () => {
    await store.close();
  });

  it("CRUD 往返,类型保持", async () => {
    const insert = await store.execute("INSERT INTO users (name, age) VALUES (?, ?)", ["alice", 30]);
    expect(insert.affectedRows).toBe(1);

    const rows = await store.query<{ id: number; name: string; age: number }>(
      "SELECT id, name, age FROM users WHERE age > ?",
      [18],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "alice", age: 30 });
    expect(typeof rows[0]!.id).toBe("number");

    const updated = await store.execute("UPDATE users SET age = ? WHERE name = ?", [31, "alice"]);
    expect(updated.affectedRows).toBe(1);

    const deleted = await store.execute("DELETE FROM users WHERE name = ?", ["alice"]);
    expect(deleted.affectedRows).toBe(1);
    expect(await store.query("SELECT * FROM users")).toHaveLength(0);
  });

  it("支持 NULL 与 Buffer 参数", async () => {
    const buf = Buffer.from([1, 2, 3]);
    await store.execute("INSERT INTO users (name, age, avatar) VALUES (?, ?, ?)", ["bob", null, buf]);
    const rows = await store.query<{ age: number | null; avatar: Buffer }>(
      "SELECT age, avatar FROM users WHERE name = ?",
      ["bob"],
    );
    expect(rows[0]!.age).toBeNull();
    expect(Buffer.compare(rows[0]!.avatar as Buffer, buf)).toBe(0);
  });

  it("参数化防注入:参数按字面值处理,不执行", async () => {
    const evil = "'; DROP TABLE users; --";
    await store.execute("INSERT INTO users (name) VALUES (?)", [evil]);
    const rows = await store.query("SELECT * FROM users");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe(evil);
    // 表仍然存在,可以继续查询
    expect(await store.query("SELECT COUNT(*) AS c FROM users")).toEqual([{ c: 1 }]);
  });

  it("事务成功提交", async () => {
    await store.transaction(async (tx) => {
      await tx.execute("INSERT INTO users (name, age) VALUES (?, ?)", ["carol", 25]);
      await tx.execute("INSERT INTO users (name, age) VALUES (?, ?)", ["dave", 28]);
    });
    expect(await store.query("SELECT COUNT(*) AS c FROM users")).toEqual([{ c: 2 }]);
  });

  it("事务抛错自动回滚", async () => {
    await expect(
      store.transaction(async (tx) => {
        await tx.execute("INSERT INTO users (name, age) VALUES (?, ?)", ["eve", 20]);
        throw new Error("中途失败");
      }),
    ).rejects.toThrow("中途失败");
    expect(await store.query("SELECT COUNT(*) AS c FROM users")).toEqual([{ c: 0 }]);
  });

  it("嵌套事务抛 TRANSACTION_ACTIVE", async () => {
    await expect(
      store.transaction(async (tx) => {
        await tx.execute("INSERT INTO users (name) VALUES (?)", ["frank"]);
        return tx.transaction(async () => {
          // 不应执行到这里
        });
      }),
    ).rejects.toMatchObject({ code: DataErrorCode.TRANSACTION_ACTIVE });
    // 外层事务已回滚
    expect(await store.query("SELECT COUNT(*) AS c FROM users")).toEqual([{ c: 0 }]);
  });

  it("SQL 语法错误 → QUERY_SYNTAX", async () => {
    await expect(store.query("SELECT FROM")).rejects.toMatchObject({ code: DataErrorCode.QUERY_SYNTAX });
  });

  it("唯一约束违反 → CONSTRAINT", async () => {
    await store.execute("INSERT INTO users (name) VALUES (?)", ["grace"]);
    await expect(store.execute("INSERT INTO users (name) VALUES (?)", ["grace"])).rejects.toMatchObject({
      code: DataErrorCode.CONSTRAINT,
    });
  });

  it("配置非法 → CONFIGURATION", () => {
    expect(() => createDataStore({ dialect: "sqlite", path: "" })).toThrowError(
      expect.objectContaining({ code: DataErrorCode.CONFIGURATION }),
    );
  });

  it("ping 通过", async () => {
    await expect(store.ping()).resolves.toBeUndefined();
  });

  it("close 后操作 → CLOSED,close 幂等", async () => {
    await store.close();
    await expect(store.query("SELECT 1")).rejects.toMatchObject({ code: DataErrorCode.CLOSED });
    await expect(store.close()).resolves.toBeUndefined();
  });

  it("错误是 DataError 实例且带 code", async () => {
    const err = await store.query("SELECT FROM").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect((err as DataError).code).toBe(DataErrorCode.QUERY_SYNTAX);
  });
});
