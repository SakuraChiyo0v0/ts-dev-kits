import { afterEach, describe, expect, it } from "vitest";
import {
  config,
  createConfigCenter,
  initConfig,
  resetConfig,
  type ConfigBackend,
} from "../src/index.js";

const TEST_KEY = "0123456789abcdef0123456789abcdef";

/** 内存假后端：仅用于验证装配行为，不做真实 IO。 */
function memBackend(): ConfigBackend {
  const store = new Map<string, string>();
  const api: ConfigBackend = {
    async load<T>(key: string): Promise<T> {
      const v = store.get(key);
      if (v === undefined) throw new Error("NOT_FOUND");
      return v as T;
    },
    async save(key, value): Promise<void> {
      store.set(key, String(value));
    },
    async list(): Promise<string[]> {
      return [...store.keys()];
    },
    async remove(key): Promise<void> {
      store.delete(key);
    },
    withPrefix(): ConfigBackend {
      return api;
    },
  };
  return api;
}

describe("initConfig / config / resetConfig（进程级默认 + 覆盖）", () => {
  afterEach(() => {
    resetConfig();
  });

  it("未初始化时 config() 抛 VALIDATION", () => {
    expect(() => config()).toThrowError(expect.objectContaining({ code: "VALIDATION" }));
  });

  it("initConfig 后 config() 复用同一默认实例", () => {
    const center = initConfig({ backend: memBackend(), key: TEST_KEY });
    expect(config()).toBe(center);
  });

  it("config(options) 显式覆盖返回新实例，且不改默认", () => {
    const def = initConfig({ backend: memBackend(), key: TEST_KEY });
    const override = config({ backend: memBackend(), key: TEST_KEY });
    expect(override).not.toBe(def);
    expect(config()).toBe(def);
  });

  it("resetConfig 后 config() 再次抛 VALIDATION", () => {
    initConfig({ backend: memBackend(), key: TEST_KEY });
    resetConfig();
    expect(() => config()).toThrowError(expect.objectContaining({ code: "VALIDATION" }));
  });

  it("createConfigCenter() 无参不再自动读全局配置，抛 VALIDATION", () => {
    expect(() => createConfigCenter()).toThrowError(expect.objectContaining({ code: "VALIDATION" }));
  });

  it("顶层 key 正交于 backend：initConfig({ backend, key }) 加密域可用", () => {
    const center = initConfig({ backend: memBackend(), key: TEST_KEY });
    // 加密 namespace 不抛「缺密钥」——key 从顶层字段传入。
    const ns = center.namespace("auth", { encrypt: true });
    expect(ns.encrypt).toBe(true);
  });
});
