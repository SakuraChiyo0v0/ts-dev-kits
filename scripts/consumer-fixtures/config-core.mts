import assert from "node:assert/strict";
import { createConfigCenter, PrefixBackend, type ConfigBackend } from "@sakurachiyo0v0/config";
const data = new Map<string, unknown>();
const backend: ConfigBackend = {
  async load<T>(key: string) { return data.get(key) as T; },
  async save(key, value) { data.set(key, value); },
  async remove(key) { data.delete(key); },
  async list() { return [...data.keys()]; },
  withPrefix(prefix) { return new PrefixBackend(this, prefix); },
};
const ns = createConfigCenter({ backend, key: "test-key" }).namespace("auth");
await ns.set("local", { secret: "hello" });
assert.deepEqual(await ns.get("local"), { secret: "hello" });
assert(!String(data.get("amechan:secrets:auth:local")).includes("hello"));
assert.deepEqual(await ns.list(), ["local"]); await ns.remove("local"); assert.deepEqual(await ns.list(), []);
