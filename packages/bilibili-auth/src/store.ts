/**
 * 登录态存储 —— 平台标准用户配置目录下的 auth.json。
 * 内容仅含 B 站会话凭证(cookie 字符串 + refresh_token),文件权限 600。
 * 所有路径解析为纯函数,便于测试。
 */
import { promises as fs } from "node:fs";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** 存储的登录态数据。 */
export interface AuthData {
  /** 完整 cookie 字符串,如 "SESSDATA=...; bili_jct=...; DedeUserID=..."。 */
  cookies: string;
  /** 续期用 refresh_token。 */
  refreshToken: string;
  /** 匿名 buvid3(可选,保持请求特征稳定)。 */
  buvid3?: string;
  /** 保存时间(ISO)。 */
  savedAt: string;
  /** 预期过期时间(ISO,可选)。 */
  expiresAt?: string;
}

/** 平台标准用户配置根目录(纯函数,便于测试)。 */
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

/** 默认 auth.json 路径:<配置根>/amechan/bilibili/auth.json。 */
export function defaultAuthPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveConfigRoot(platform, env), "amechan", "bilibili", "auth.json");
}

/** 登录态存储:auth.json 的读写与清理。 */
export class AuthStore {
  readonly #path: string;

  constructor(authPath?: string) {
    this.#path = authPath ?? defaultAuthPath();
  }

  /** auth.json 的完整路径。 */
  get path(): string {
    return this.#path;
  }

  /** 文件是否存在。 */
  exists(): boolean {
    try {
      return statSync(this.#path).isFile();
    } catch {
      return false;
    }
  }

  /** 同步读取登录态(客户端构造时用);不存在或损坏返回 null。 */
  loadSync(): AuthData | null {
    let text: string;
    try {
      text = readFileSync(this.#path, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return null;
      }
      console.warn(`[bilibili-auth] 读取登录态失败(${this.#path}):`, error);
      return null;
    }
    return parseAuthData(text, this.#path);
  }

  /** 读取登录态;不存在或损坏返回 null(损坏时告警,不抛错)。 */
  async load(): Promise<AuthData | null> {
    let text: string;
    try {
      text = await fs.readFile(this.#path, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return null;
      }
      console.warn(`[bilibili-auth] 读取登录态失败(${this.#path}):`, error);
      return null;
    }
    return parseAuthData(text, this.#path);
  }

  /** 原子写入登录态:同目录临时文件 + rename,并设置 600 权限。 */
  async save(data: AuthData): Promise<void> {
    await fs.mkdir(path.dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: "utf-8" });
    try {
      await fs.chmod(tmp, 0o600);
    } catch {
      // Windows 上 chmod 受限,尽力而为。
    }
    await fs.rename(tmp, this.#path);
  }

  /** 删除登录态;文件不存在时静默成功。 */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.#path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }
}

/** 解析 auth.json 文本为 AuthData;损坏返回 null(带告警)。 */
function parseAuthData(text: string, filePath: string): AuthData | null {
  try {
    const parsed = JSON.parse(text) as Partial<AuthData>;
    if (
      typeof parsed.cookies !== "string" ||
      parsed.cookies === "" ||
      typeof parsed.refreshToken !== "string" ||
      parsed.refreshToken === ""
    ) {
      console.warn(`[bilibili-auth] 登录态文件损坏(${filePath}),视为未登录`);
      return null;
    }
    return {
      cookies: parsed.cookies,
      refreshToken: parsed.refreshToken,
      ...(typeof parsed.buvid3 === "string" && parsed.buvid3 !== ""
        ? { buvid3: parsed.buvid3 }
        : {}),
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString(),
      ...(typeof parsed.expiresAt === "string" && parsed.expiresAt !== ""
        ? { expiresAt: parsed.expiresAt }
        : {}),
    };
  } catch {
    console.warn(`[bilibili-auth] 登录态文件损坏(${filePath}),视为未登录`);
    return null;
  }
}
