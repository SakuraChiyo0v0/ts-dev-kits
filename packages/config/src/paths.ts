import { homedir } from "node:os";
import { join } from "node:path";

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
