/**
 * 后端包装器契约测试：PrefixBackend / JsonBackend / EncryptedBackend 的往返一致性。
 * 底层用一个内存 fake ConfigBackend（字符串透明），验证上层包装行为。
 */
import { describe, expect, it } from "vitest";
import { EncryptedBackend, JsonBackend, PrefixBackend, encryptedBackend, type ConfigBackend } from "../src/index.js";

/** 内存 fake 后端：字符串透明（存字符串、读字符串）。 */
class MemoryBackend implements ConfigBackend {
  readonly map = new Map<string, string>();

  async load<T = unknown>(key: string): Promise<T> {
    const raw = this.map.get(key);
    if (raw === undefined) throw new Error("NOT_FOUND");
    return raw as T;
  }
  async save(key: string, value: unknown): Promise<void> {
    this.map.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  async list(): Promise<string[]> {
    return [...this.map.keys()];
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
  withPrefix(prefix: string): ConfigBackend {
    return new PrefixBackend(this, prefix);
  }
}

describe("ConfigBackend 包装契约", () => {
  it("JsonBackend 往返（明文域）", async () => {
    const root = new MemoryBackend();
    const ns = new JsonBackend(root.withPrefix("amechan:configs:demo"));
    await ns.save("key", { a: 1, b: "x" });
    expect(await ns.load("key")).toEqual({ a: 1, b: "x" });
    expect(root.map.get("amechan:configs:demo:key")).toBe('{"a":1,"b":"x"}');
  });

  it("EncryptedBackend 往返（加密域，密文不含明文）", async () => {
    const root = new MemoryBackend();
    const ns = encryptedBackend(root.withPrefix("amechan:secrets:demo"), "test-key-123");
    await ns.save("key", { secret: "hello" });
    const stored = root.map.get("amechan:secrets:demo:key");
    expect(stored).toContain('"data"');
    expect(stored).not.toContain("hello");
    expect(await ns.load("key")).toEqual({ secret: "hello" });
  });

  it("EncryptedBackend 包装字符串透明底层（兼容旧密文格式）", async () => {
    // 密文是字符串：底层必须原样存（不二次 JSON 编码），读回是字符串。
    const root = new MemoryBackend();
    const ns = encryptedBackend(root.withPrefix("p"), "k");
    await ns.save("a", 42);
    const stored = root.map.get("p:a");
    // 存的是密文 JSON 字符串本身（对象 → string，不带外层引号）。
    expect(typeof stored).toBe("string");
    expect(stored?.startsWith("{")).toBe(true);
    // 读回 → 解密 → 42
    expect(await ns.load("a")).toBe(42);
  });

  it("前缀隔离（withPrefix）", async () => {
    const root = new MemoryBackend();
    const a = new JsonBackend(root.withPrefix("amechan:configs:a"));
    const b = new JsonBackend(root.withPrefix("amechan:configs:b"));
    await a.save("k", 1);
    await b.save("k", 2);
    expect(await a.load("k")).toBe(1);
    expect(await b.load("k")).toBe(2);
    expect(await a.list()).toEqual(["k"]);
  });

  it("缺 key 抛 NOT_FOUND（与 WebDAV 对齐）", async () => {
    const root = new MemoryBackend();
    const ns = new JsonBackend(root.withPrefix("p"));
    await expect(ns.load("missing")).rejects.toThrow("NOT_FOUND");
  });

  it("非法表名被拒绝", async () => {
    // 直接验证 PgBackend 构造器校验（不连库）。
    const { PgBackend } = await import("../src/index.js");
    expect(() => new PgBackend({ url: "postgres://x", table: "bad;DROP TABLE" })).toThrow("非法表名");
    expect(() => new PgBackend({ url: "postgres://x", table: "config_kv" })).not.toThrow();
  });
});
