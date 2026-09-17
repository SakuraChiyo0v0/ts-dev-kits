import { createConfigStore, createWebdavClient, type ConfigStore } from "@sakurachiyo0v0/webdav";
import { createConfigCenter, type ConfigBackend, type ConfigCenter } from "@sakurachiyo0v0/config";
import { loadGlobalConfig } from "./global-config.js";
import type { GlobalConfig } from "./types.js";

export function createWebdavBackend(global: GlobalConfig): ConfigBackend {
  const client = createWebdavClient({
    url: global.url,
    ...(global.username !== undefined ? { username: global.username } : {}),
    ...(global.password !== undefined ? { password: global.password } : {}),
  });
  const cache = new Map<string, ConfigStore>();
  const makeStore = (basePath: string): ConfigStore => {
    let store = cache.get(basePath);
    if (store === undefined) {
      // format: "text" —— 字符串透明，与加密域旧密文（纯文本）兼容；
      // JSON 序列化统一由上层 JsonBackend/EncryptedBackend 负责。
      store = createConfigStore({ client, basePath, format: "text" });
      cache.set(basePath, store);
    }
    return store;
  };
  const api = (basePath: string): ConfigBackend => ({
    load: (key) => makeStore(basePath).load(key),
    save: (key, value) => makeStore(basePath).save(key, value),
    list: () => makeStore(basePath).list(),
    remove: (key) => makeStore(basePath).remove(key),
    withPrefix(prefix) {
      // WebDAV 是路径语义：把统一前缀的 ":" 转成 "/"。
      const next = prefix.replace(/:/g, "/");
      const joined = basePath === "/" ? `/${next}` : `${basePath}/${next}`;
      return api(joined);
    },
  });
  return api("/");
}

/** 显式传连接配置，或从指定/默认文件加载。 */
export function createWebdavConfigCenter(options?: GlobalConfig | string): ConfigCenter & { readonly url: string } {
  const global = typeof options === "object" ? options : loadGlobalConfig(options);
  const center = createConfigCenter({ backend: createWebdavBackend(global), ...(global.key !== undefined ? { key: global.key } : {}) });
  return Object.assign(center, { url: global.url });
}
