import { homedir } from "node:os";
import { join } from "node:path";

/** 配置根目录；与 config 的路径规则由一致性测试约束。 */
export function resolveConfigRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.AMECHAN_CONFIG_HOME;
  if (override !== undefined && override.length > 0) return override;
  if (platform === "win32") {
    return env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  }
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support");
  }
  return env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}

/** 默认 auth.json 路径:<配置根>/amechan/<platform>/auth.json。 */
export function defaultAuthPath(
  platformName: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveConfigRoot(platform, env), "amechan", platformName, "auth.json");
}
