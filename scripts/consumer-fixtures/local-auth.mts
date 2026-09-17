import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AuthStore, type AuthRemoteStore } from "@sakurachiyo0v0/account";
const path = join(process.cwd(), "auth.json");
const payload = { platform: "demo", credentials: { cookie: "local-test" }, savedAt: "2026-09-01T00:00:00.000Z" };
// 写入既有文件格式，验证拆分后可直接读取。
writeFileSync(path, JSON.stringify(payload));
const store = new AuthStore({ platform: "demo", path });
assert.deepEqual(store.loadSync(), payload);
assert.deepEqual(await store.load(), payload);
let value: unknown;
const remote: AuthRemoteStore = { async get<T>() { return value as T; }, async set(_key, data) { value = data; }, async remove() { value = undefined; } };
const synced = new AuthStore({ platform: "demo", path, remote });
await synced.save(payload); assert.deepEqual(value, payload);
assert.deepEqual(await synced.load(), payload);
const offline: AuthRemoteStore = { ...remote, async get() { throw new Error("offline"); } };
assert.deepEqual(await new AuthStore({ platform: "demo", path, remote: offline }).load(), payload);
