/**
 * 登录态存储 —— 平台标准用户配置目录下的 auth.json。
 * 内容仅含平台会话凭证(平台专属字段),文件权限 600。
 * 与 bilibili-auth 的 AuthStore 同款原子写 + 600 权限,路径按平台命名空间隔离。
 */
import { promises as fs } from "node:fs";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ConfigNamespace } from "@sakurachiyo0v0/config";
import { defaultAuthPath } from "./paths.js";

/** 远程(WebDAV)操作超时:服务器不可达/挂起时及时降级本地,避免卡住 */
export const REMOTE_TIMEOUT_MS = 5000;

/** 给远程操作加超时:超时抛错(由调用方降级处理) */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`远程操作超时(${ms}ms)`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 存储的登录态载荷:平台凭证 + 元信息。平台字段放在 credentials 内。 */
export interface AuthPayload {
  /** 平台名(如 "netease-music"),写入文件便于校验。 */
  platform: string;
  /** 平台专属凭证(由平台适配器序列化,如 cookie 对象/refresh_token 等)。 */
  credentials: Record<string, unknown>;
  /** 保存时间(ISO)。 */
  savedAt: string;
  /** 预期过期时间(ISO,可选)。 */
  expiresAt?: string;
}

export interface AuthStoreOptions {
  /** 平台名,决定默认路径 <配置根>/amechan/<platform>/auth.json。 */
  platform: string;
  /** 自定义路径(覆盖默认)。 */
  path?: string;
  /**
   * 可选远程配置命名空间(通常为配置中心的加密域)。
   * 配置后登录态**双写**(本地 + 远程),load 优先远程(换机可还原),
   * 远程不可达时降级本地(带告警)。
   */
  remote?: ConfigNamespace;
}

/** 登录态存储:auth.json 的读写与清理(可选远程同步)。 */
export class AuthStore {
  readonly #path: string;
  readonly #platform: string;
  readonly #remote?: ConfigNamespace;

  constructor(options: AuthStoreOptions) {
    this.#platform = options.platform;
    this.#path = options.path ?? defaultAuthPath(options.platform);
    if (options.remote !== undefined) this.#remote = options.remote;
  }

  /** 平台名。 */
  get platform(): string {
    return this.#platform;
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
  loadSync(): AuthPayload | null {
    let text: string;
    try {
      text = readFileSync(this.#path, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return null;
      }
      console.warn(`[account] 读取登录态失败(${this.#path}):`, error);
      return null;
    }
    return parseAuthPayload(text, this.#path);
  }

  /** 读取登录态;不存在或损坏返回 null(损坏时告警,不抛错)。配置远程时优先远程,失败/超时降级本地;远程成功回写本地缓存。 */
  async load(): Promise<AuthPayload | null> {
    if (this.#remote !== undefined) {
      try {
        const payload = await withTimeout(this.#remote.get<AuthPayload>(this.#platform), REMOTE_TIMEOUT_MS);
        // 远程成功:回写本地缓存,保证 SDK 的 loadSync(同步)也能读到
        try {
          await this.saveLocal(payload);
        } catch {
          // 本地回写失败不影响返回
        }
        return payload;
      } catch (error) {
        if (error instanceof Error && (error as { code?: string }).code !== "NOT_FOUND") {
          console.warn(`[account] 远程登录态读取失败(${this.#platform}),降级本地:`, error);
        }
      }
    }
    let text: string;
    try {
      text = await fs.readFile(this.#path, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return null;
      }
      console.warn(`[account] 读取登录态失败(${this.#path}):`, error);
      return null;
    }
    return parseAuthPayload(text, this.#path);
  }

  /** 仅写本地(原子写 + 600 权限),供 save 与远程回写共用。 */
  private async saveLocal(payload: AuthPayload): Promise<void> {
    await fs.mkdir(path.dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), { encoding: "utf-8" });
    try {
      await fs.chmod(tmp, 0o600);
    } catch {
      // Windows 上 chmod 受限,尽力而为。
    }
    await fs.rename(tmp, this.#path);
  }

  /** 原子写入登录态;配置远程时同步写远程(失败/超时降级告警,本地保留)。 */
  async save(payload: AuthPayload): Promise<void> {
    await this.saveLocal(payload);
    if (this.#remote !== undefined) {
      try {
        await withTimeout(this.#remote.set(this.#platform, payload), REMOTE_TIMEOUT_MS);
      } catch (error) {
        console.warn(`[account] 远程登录态同步失败(${this.#platform}),已保留本地:`, error);
      }
    }
  }

  /** 删除登录态;文件不存在时静默成功。配置远程时同步删除远程(失败/超时告警)。 */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.#path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
    if (this.#remote !== undefined) {
      try {
        await withTimeout(this.#remote.remove(this.#platform), REMOTE_TIMEOUT_MS);
      } catch (error) {
        console.warn(`[account] 远程登录态删除失败(${this.#platform}):`, error);
      }
    }
  }
}

/** 解析 auth.json 文本为 AuthPayload;损坏返回 null(带告警)。 */
function parseAuthPayload(text: string, filePath: string): AuthPayload | null {
  try {
    const parsed = JSON.parse(text) as Partial<AuthPayload>;
    if (
      typeof parsed.platform !== "string" ||
      parsed.platform === "" ||
      typeof parsed.credentials !== "object" ||
      parsed.credentials === null ||
      Object.keys(parsed.credentials).length === 0
    ) {
      console.warn(`[account] 登录态文件损坏(${filePath}),视为未登录`);
      return null;
    }
    return {
      platform: parsed.platform,
      credentials: parsed.credentials,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString(),
      ...(typeof parsed.expiresAt === "string" && parsed.expiresAt !== ""
        ? { expiresAt: parsed.expiresAt }
        : {}),
    };
  } catch {
    console.warn(`[account] 登录态文件损坏(${filePath}),视为未登录`);
    return null;
  }
}
