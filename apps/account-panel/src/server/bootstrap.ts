/**
 * 统一认证装配 —— 环境变量 → ConfigCenter → 加密命名空间。
 * 不读本地 config.json、不跑 sc-config setup；WebDAV 是唯一事实源。
 */
import { createConfigCenter } from "@sakurachiyo0v0/config";
import type { ConfigCenter, ConfigNamespace } from "@sakurachiyo0v0/config";
import { AuthStore } from "@sakurachiyo0v0/account";

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}

/** 从环境变量创建配置中心（显式传 global，不读本地文件）。 */
export function createAppCenter(): ConfigCenter {
  return createConfigCenter({
    global: {
      url: env("WEBDAV_URL"),
      ...(process.env.WEBDAV_USERNAME !== undefined && process.env.WEBDAV_USERNAME !== ""
        ? { username: process.env.WEBDAV_USERNAME }
        : {}),
      ...(process.env.WEBDAV_PASSWORD !== undefined && process.env.WEBDAV_PASSWORD !== ""
        ? { password: process.env.WEBDAV_PASSWORD }
        : {}),
      ...(process.env.WEBDAV_CONFIG_KEY !== undefined && process.env.WEBDAV_CONFIG_KEY !== ""
        ? { key: process.env.WEBDAV_CONFIG_KEY }
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
