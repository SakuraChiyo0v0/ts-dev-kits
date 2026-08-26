import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createLogger } from "@sakurachiyo0v0/logger";
import { WebdavError, WebdavErrorCode } from "@sakurachiyo0v0/webdav";
import type { GlobalConfig } from "./types.js";

const logger = createLogger({ namespace: "config" }).child("global-config");

/** 提取 URL 的 host 部分用于日志(不含凭据/路径,防 user:pass@ 泄露) */
function logHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(invalid url)";
  }
}

/** 解析全局配置文件路径:显式 > AME_CONFIG_PATH > <配置根>/amechan/config.json */
export function resolveConfigPath(customPath?: string): string {
  if (customPath !== undefined && customPath.length > 0) return customPath;
  const envPath = process.env.AME_CONFIG_PATH;
  if (envPath !== undefined && envPath.length > 0) return envPath;
  return join(configRoot(), "amechan", "config.json");
}

function configRoot(): string {
  const override = process.env.AMECHAN_CONFIG_HOME;
  if (override !== undefined && override.length > 0) return override;
  if (process.platform === "win32") {
    return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support");
  }
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}

/** 写入全局配置(目录自动创建,文件 600 权限) */
export function saveGlobalConfig(config: GlobalConfig, customPath?: string): string {
  if (!config.url || config.url.trim().length === 0) {
    throw new WebdavError(WebdavErrorCode.VALIDATION, "全局配置缺少 webdav url");
  }
  const path = resolveConfigPath(customPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows 上 chmod 可能受限,忽略
  }
  logger.info("global config saved", { path, host: logHost(config.url) });
  return path;
}

/** 读取全局配置;不存在抛 VALIDATION */
export function loadGlobalConfig(customPath?: string): GlobalConfig {
  const path = resolveConfigPath(customPath);
  if (!existsSync(path)) {
    logger.debug("global config not found", { path });
    throw new WebdavError(
      WebdavErrorCode.VALIDATION,
      `未找到全局配置 ${path},请先运行 sc-config setup`,
    );
  }
  try {
    const config = JSON.parse(readFileSync(path, "utf8")) as GlobalConfig;
    logger.debug("global config loaded", { path, host: logHost(config.url) });
    return config;
  } catch (err) {
    logger.error("failed to parse global config", { path, error: err });
    throw new WebdavError(WebdavErrorCode.VALIDATION, `全局配置解析失败: ${path}`, err);
  }
}

/** 删除全局配置 */
export function clearGlobalConfig(customPath?: string): void {
  const path = resolveConfigPath(customPath);
  if (existsSync(path)) {
    rmSync(path);
    logger.info("global config cleared", { path });
  }
}
