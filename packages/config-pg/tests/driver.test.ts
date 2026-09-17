import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), Pool: vi.fn() }));
vi.mock("pg", () => ({ Pool: fake.Pool.mockImplementation(function () { return { query: fake.query, end: fake.end }; }) }));
import { PgBackend } from "../src/index.js";
import { createConfigCenter } from "@sakurachiyo0v0/config";
beforeEach(() => { fake.query.mockReset().mockResolvedValue({ rows: [] }); fake.end.mockReset().mockResolvedValue(undefined); });
it("并发首次写入只建表一次，SQL 值使用参数，关闭释放连接", async () => {
  const backend = new PgBackend({ url: "postgres://localhost/test" });
  const ns = createConfigCenter({ backend }).namespace("demo", { encrypt: false });
  await Promise.all([ns.set("a", { x: 1 }), ns.set("b", { x: 2 })]);
  expect(fake.query.mock.calls.filter(([sql]) => sql.startsWith("CREATE TABLE"))).toHaveLength(1);
  expect(fake.query).toHaveBeenCalledWith(expect.stringContaining("VALUES ($1, $2)"), ["amechan:configs:demo:a", '{"x":1}']);
  await backend.close(); expect(fake.end).toHaveBeenCalledOnce();
});
it("建表失败后允许重试；缺失键提供 NOT_FOUND", async () => {
  const backend = new PgBackend({ url: "postgres://localhost/test" });
  fake.query.mockRejectedValueOnce(new Error("offline"));
  await expect(backend.init()).rejects.toThrow("offline");
  await backend.init();
  await expect(backend.load("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  await backend.close();
});
it("密文经 PG 字符串存取后可还原，读取删除均带键参数", async () => {
  const backend = new PgBackend({ url: "postgres://localhost/test" });
  const ns = createConfigCenter({ backend, key: "test-only" }).namespace("auth");
  await ns.set("session", { cookie: "secret-value" });
  const insert = fake.query.mock.calls.find(([sql]) => sql.startsWith("INSERT"))!;
  const ciphertext = insert[1][1];
  expect(ciphertext).not.toContain("secret-value");
  fake.query.mockResolvedValueOnce({ rows: [{ value: ciphertext }] });
  expect(await ns.get("session")).toEqual({ cookie: "secret-value" });
  await ns.remove("session");
  expect(fake.query).toHaveBeenCalledWith(expect.stringContaining("WHERE key = $1"), ["amechan:secrets:auth:session"]);
  await backend.close();
});
