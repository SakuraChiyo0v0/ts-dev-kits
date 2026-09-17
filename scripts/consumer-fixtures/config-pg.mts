import assert from "node:assert/strict";
import { createConfigCenter } from "@sakurachiyo0v0/config";
import { PgBackend } from "@sakurachiyo0v0/config-pg";
const backend = new PgBackend({ url: "postgres://localhost/not-connected" });
try { assert.equal(createConfigCenter({ backend, key: "test-only" }).namespace("auth").encrypt, true); }
finally { await backend.close(); }
// 不连接真实数据库；SQL 行为由适配包驱动替身测试覆盖。
