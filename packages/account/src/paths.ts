/**
 * 平台标准用户配置目录解析。
 *
 * 唯一权威实现已收敛到 `@sakurachiyo0v0/config` 的 `resolveConfigRoot`,
 * 此处仅 re-export 以保持本包既有公共 API 兼容(旧消费方可能 import 自 account)。
 */
import { resolveConfigRoot as configResolveConfigRoot } from "@sakurachiyo0v0/config";
import path from "node:path";

/** 平台标准用户配置根目录(权威实现见 @sakurachiyo0v0/config)。 */
export function resolveConfigRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return configResolveConfigRoot(platform, env);
}

/** 默认 auth.json 路径:<配置根>/amechan/<platform>/auth.json。 */
export function defaultAuthPath(
  platformName: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveConfigRoot(platform, env), "amechan", platformName, "auth.json");
}
