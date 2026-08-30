/**
 * 统一认证装配 —— 环境变量 → ConfigCenter → 加密命名空间。
 * 存储后端：PostgreSQL（PG_URL + CONFIG_KEY）。入口 initAppConfig() 初始化一次，后续 config() 读默认。
 */
import { initConfig, config, PgBackend } from "@sakurachiyo0v0/config";
import type { ConfigCenter, ConfigNamespace } from "@sakurachiyo0v0/config";
import { AuthStore } from "@sakurachiyo0v0/account";

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}

/** 初始化进程级配置中心（组合根入口调用一次）：PG 后端 + 加密密钥。 */
export function initAppConfig(): ConfigCenter {
  const backend = new PgBackend({ url: env("PG_URL").trim() });
  void backend.init().catch(() => {
    // 建表失败不阻塞启动（首次连接 PG 未就绪时稍后重试）。
  });
  return initConfig({ backend, key: env("CONFIG_KEY") });
}

/** 统一登录态远程命名空间（所有平台共用这一个加密域）。 */
export function createAuthNamespace(): ConfigNamespace {
  return config().namespace("auth", { encrypt: true });
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
