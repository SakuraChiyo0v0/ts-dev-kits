/**
 * 统一认证装配 —— 环境变量 → ConfigCenter → 加密命名空间。
 * 存储后端可插拔：设置 PG_URL 走 PostgreSQL（新建部署），否则走 WebDAV（兼容既有）。
 */
import { createConfigCenter, PgBackend } from "@sakurachiyo0v0/config";
import type { ConfigCenter, ConfigNamespace } from "@sakurachiyo0v0/config";
import { AuthStore } from "@sakurachiyo0v0/account";

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}

/** 模块级单例：PgBackend（连接池）只建一次，避免每请求 new Pool 泄漏。 */
let pgBackendSingleton: PgBackend | null = null;

/** 从环境变量创建配置中心（显式传 global，不读本地文件）。 */
export function createAppCenter(): ConfigCenter {
  const pgUrl = process.env.PG_URL;
  if (pgUrl !== undefined && pgUrl.trim() !== "") {
    // PostgreSQL 后端：新建部署首选。连接池单例复用。
    if (pgBackendSingleton === null) {
      pgBackendSingleton = new PgBackend({ url: pgUrl.trim() });
      void pgBackendSingleton.init().catch(() => {
        // 建表失败不阻塞启动（首次连接 PG 未就绪时稍后重试）。
      });
    }
    const key = process.env.CONFIG_KEY;
    if (key === undefined || key.trim() === "") {
      throw new Error("缺少环境变量 CONFIG_KEY（加密密钥）");
    }
    return createConfigCenter({
      global: { url: "", key },
      backend: pgBackendSingleton,
    });
  }
  // WebDAV 兼容路径（无 PG_URL）。
  return createConfigCenter({
    global: {
      url: env("WEBDAV_URL"),
      ...(process.env.WEBDAV_USERNAME !== undefined && process.env.WEBDAV_USERNAME !== ""
        ? { username: process.env.WEBDAV_USERNAME }
        : {}),
      ...(process.env.WEBDAV_PASSWORD !== undefined && process.env.WEBDAV_PASSWORD !== ""
        ? { password: process.env.WEBDAV_PASSWORD }
        : {}),
      ...(process.env.CONFIG_KEY !== undefined && process.env.CONFIG_KEY !== ""
        ? { key: process.env.CONFIG_KEY }
        : {}),
    },
  });
}

/** 统一登录态远程命名空间（所有平台共用这一个加密域）。 */
export function createAuthNamespace(): ConfigNamespace {
  return createAppCenter().namespace("auth", { encrypt: true });
}

/**
 * 预热登录态：远程优先拉取并回写本地缓存。
 * 这样后续各平台 SDK client 内部的 loadSync（同步读本地）能读到登录态。
 * 远程不可达/未登录时返回 null，不抛错。
 */
export async function warmupAuth(platform: string): Promise<AuthStore> {
  const store = new AuthStore({ platform, remote: createAuthNamespace() });
  await store.load();
  return store;
}
