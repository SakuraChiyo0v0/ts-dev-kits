import type { CookieStore } from "./types.js";

/** 进程内内存 cookie 缓存（默认实现；需要持久化时传入自定义 CookieStore） */
export function createMemoryCookieStore(): CookieStore {
  let value: { cookie: string; savedAt: number } | null = null;
  return {
    get: () => value,
    set: (cookie, savedAt) => {
      value = { cookie, savedAt };
    },
    clear: () => {
      value = null;
    },
  };
}
