/**
 * 平台标准用户配置目录解析(纯函数,便于测试)。
 * 与 bilibili-auth 的 resolveConfigRoot 逻辑一致,提取为通用能力。
 */
import { homedir } from "node:os";
import path from "node:path";

/** 平台标准用户配置根目录。 */
export function resolveConfigRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.AMECHAN_CONFIG_HOME;
  if (explicit !== undefined && explicit !== "") {
    return explicit;
  }
  if (platform === "win32") {
    const appData = env.APPDATA;
    if (appData !== undefined && appData !== "") {
      return appData;
    }
  }
  if (platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support");
  }
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg !== undefined && xdg !== "") {
    return xdg;
  }
  return path.join(homedir(), ".config");
}

/** 默认 auth.json 路径:<配置根>/amechan/<platform>/auth.json。 */
export function defaultAuthPath(
  platformName: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveConfigRoot(platform, env), "amechan", platformName, "auth.json");
}
