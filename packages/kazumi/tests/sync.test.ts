/**
 * 规则 WebDAV 同步测试 —— fake config center 验证远端读写与优雅回退。
 */
import { describe, expect, it } from "vitest";
import { RuleSync } from "../src/rules/sync.js";
import type { ConfigNamespace } from "@sakurachiyo0v0/config";

/** 内存版 fake namespace。 */
function fakeNamespace(): ConfigNamespace & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    name: "kazumi",
    encrypt: false,
    store,
    async get<T>(key: string): Promise<T> {
      if (!store.has(key)) {
        const err = new Error(`NOT_FOUND: ${key}`) as Error & { code?: string };
        err.code = "NOT_FOUND";
        throw err;
      }
      return store.get(key) as T;
    },
    async set(key: string, data: unknown): Promise<void> {
      store.set(key, data);
    },
    async list(): Promise<string[]> {
      return [...store.keys()];
    },
    async remove(key: string): Promise<void> {
      store.delete(key);
    },
  };
}

/** fake center(仅实现 namespace)。 */
function fakeCenter(ns: ConfigNamespace) {
  return {
    url: "https://dav.example.com/",
    namespace: () => ns,
  } as ReturnType<typeof import("@sakurachiyo0v0/config")["createConfigCenter"]>;
}

const RULE = { api: "1", name: "demo", baseURL: "https://x.com" };

describe("RuleSync(sync 关闭)", () => {
  it("sync=false 时 enabled=false,远端操作均为空操作", async () => {
    const sync = new RuleSync(false);
    expect(sync.enabled).toBe(false);
    expect(await sync.list()).toEqual([]);
    expect(await sync.get("demo")).toBeNull();
    await expect(sync.put("demo", RULE)).resolves.toBeUndefined();
    await expect(sync.remove("demo")).resolves.toBeUndefined();
  });
});

describe("RuleSync(sync 开启,注入 fake center)", () => {
  it("put → list → get 往返", async () => {
    const ns = fakeNamespace();
    const sync = new RuleSync(true, fakeCenter(ns));
    expect(sync.enabled).toBe(true);
    await sync.put("demo", RULE);
    expect(await sync.list()).toEqual(["demo"]);
    const got = await sync.get("demo");
    expect(got).toEqual(RULE);
    await sync.remove("demo");
    expect(await sync.list()).toEqual([]);
  });

  it("get 不存在的规则返回 null(不抛)", async () => {
    const ns = fakeNamespace();
    const sync = new RuleSync(true, fakeCenter(ns));
    expect(await sync.get("nope")).toBeNull();
  });

  it("远端写入失败不抛(本地仍可用)", async () => {
    const ns = fakeNamespace();
    const failingNs = {
      ...ns,
      set: async () => {
        throw new Error("webdav down");
      },
    };
    const sync = new RuleSync(true, fakeCenter(failingNs));
    await expect(sync.put("demo", RULE)).resolves.toBeUndefined();
  });
});
