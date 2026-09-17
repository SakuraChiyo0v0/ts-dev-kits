import { it, expect } from "vitest";
it("非法表名被拒绝", async () => {
  // 直接验证 PgBackend 构造器校验（不连库）。
  const { PgBackend } = await import("../src/index.js");
  expect(() => new PgBackend({ url: "postgres://x", table: "bad;DROP TABLE" })).toThrow("非法表名");
  expect(() => new PgBackend({ url: "postgres://x", table: "config_kv" })).not.toThrow();
});
