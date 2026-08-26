import { createLogger } from "@sakurachiyo0v0/logger";
import { WebdavError, WebdavErrorCode } from "./errors.js";
import type { ConfigStore as ConfigStoreApi, ConfigStoreOptions, WebdavClient } from "./types.js";

const logger = createLogger({ namespace: "webdav" }).child("config-store");

/** 规范化 basePath:去首尾空白与尾部斜杠;空串视为根目录 "/" */
function normalizeBasePath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * 配置文件存储高层 API。
 * - save 原子写:先写临时文件再 move 覆盖,避免写一半损坏;
 * - 自动滚动备份:旧版本存 <name>.bak.1/.bak.2/...(backupCount 份)。
 */
export class ConfigStoreImpl implements ConfigStoreApi {
  private readonly client: WebdavClient;
  private readonly basePath: string;
  private readonly format: "json" | "text";
  private readonly backupCount: number;

  constructor(client: WebdavClient, options: ConfigStoreOptions = {}) {
    this.client = client;
    this.basePath = normalizeBasePath(options.basePath ?? "/configs");
    this.format = options.format ?? "json";
    this.backupCount = options.backupCount ?? 3;
  }

  /** 校验配置名并解析为远端完整路径;禁止越界(路径穿越) */
  private resolvePath(name: string): string {
    if (!name || name.length === 0) {
      throw new WebdavError(WebdavErrorCode.VALIDATION, "配置名不能为空");
    }
    if (name.includes("/") || name.includes("\\") || name.includes("..")) {
      throw new WebdavError(WebdavErrorCode.VALIDATION, `配置名非法(不允许路径分隔符/越界): ${name}`);
    }
    return `${this.basePath}/${name}`;
  }

  private serialize(data: unknown): string {
    return this.format === "json" ? JSON.stringify(data, null, 2) : String(data);
  }

  private deserialize<T>(content: string): T {
    if (this.format === "json") {
      try {
        return JSON.parse(content) as T;
      } catch (err) {
        throw new WebdavError(WebdavErrorCode.UNKNOWN, `配置内容不是合法 JSON: ${(err as Error).message}`, err);
      }
    }
    return content as T;
  }

  /** 滚动备份:bak.N → bak.N+1,目标 → bak.1 */
  private async rotateBackup(name: string): Promise<void> {
    const target = this.resolvePath(name);
    if (this.backupCount <= 0 || !(await this.client.exists(target))) return;

    for (let i = this.backupCount - 1; i >= 1; i -= 1) {
      const bak = `${target}.bak.${i}`;
      const next = `${target}.bak.${i + 1}`;
      if (await this.client.exists(bak)) {
        if (this.backupCount > i) {
          await this.client.move(bak, next);
        }
      }
    }
    await this.client.move(target, `${target}.bak.1`);
  }

  async load<T = unknown>(name: string): Promise<T> {
    const content = await this.client.get(this.resolvePath(name));
    const result = this.deserialize<T>(content);
    logger.debug("config loaded", { name });
    return result;
  }

  async save(name: string, data: unknown): Promise<void> {
    const target = this.resolvePath(name);
    const tmp = `${target}.tmp`;
    await this.rotateBackup(name);
    await this.client.put(tmp, this.serialize(data), { overwrite: true });
    await this.client.move(tmp, target);
    logger.info("config saved", { name, format: this.format });
  }

  async list(): Promise<string[]> {
    const entries = await this.client.list(this.basePath);
    const names = entries
      .filter((e) => e.type === "file" && !e.name.endsWith(".tmp") && !e.name.includes(".bak."))
      .map((e) => e.name);
    logger.debug("listed configs", { count: names.length });
    return names;
  }

  async remove(name: string): Promise<void> {
    await this.client.remove(this.resolvePath(name));
    logger.info("config removed", { name });
  }
}

/** 创建配置存储(基于已有 WebDAV 客户端) */
export function createConfigStore(options: { client: WebdavClient } & ConfigStoreOptions): ConfigStoreApi {
  return new ConfigStoreImpl(options.client, options);
}
