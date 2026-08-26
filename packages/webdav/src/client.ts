import { createClient, type FileStat, type WebDAVClient } from "webdav";
import { createLogger } from "@sakurachiyo0v0/logger";
import { WebdavError, WebdavErrorCode, wrapError } from "./errors.js";
import type { WebdavClient as WebdavClientApi, WebdavConnectionConfig, WebdavFileStat } from "./types.js";

const logger = createLogger({ namespace: "webdav" }).child("client");

/** 提取 URL 的 host 部分用于日志(不含凭据/路径,防 user:pass@ 泄露) */
function logHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(invalid url)";
  }
}

/** 规范化路径:确保以 / 开头、不以 / 结尾(根 "/" 除外) */
function normalizePath(path: string): string {
  let p = path.trim();
  if (p.length === 0) {
    throw new WebdavError(WebdavErrorCode.VALIDATION, "路径不能为空");
  }
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/** 把 webdav 库返回的二进制形态统一转为 Buffer */
function toBuffer(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  throw new WebdavError(WebdavErrorCode.UNKNOWN, "无法转换为二进制内容");
}

function mapStat(stat: FileStat): WebdavFileStat {
  return {
    path: stat.filename,
    name: stat.basename,
    type: stat.type === "directory" ? "directory" : "file",
    size: stat.size ?? 0,
    lastModified: stat.lastmod ? new Date(stat.lastmod) : new Date(0),
  };
}

/** WebdavClient 实现:薄封装 webdav 库,统一错误与路径规范化 */
export class WebdavClientImpl implements WebdavClientApi {
  private readonly inner: WebDAVClient;

  constructor(config: WebdavConnectionConfig) {
    if (!config.url || config.url.trim().length === 0) {
      throw new WebdavError(WebdavErrorCode.VALIDATION, "webdav url 不能为空");
    }
    try {
      new URL(config.url);
    } catch {
      throw new WebdavError(WebdavErrorCode.VALIDATION, "webdav url 非法");
    }
    try {
      this.inner = createClient(config.url, {
        ...(config.username !== undefined ? { username: config.username } : {}),
        ...(config.password !== undefined ? { password: config.password } : {}),
        ...(config.timeoutMs !== undefined ? { timeout: config.timeoutMs } : {}),
      });
      logger.debug("webdav client created", { host: logHost(config.url) });
    } catch (err) {
      logger.error("failed to create webdav client", {
        host: logHost(config.url),
        error: err,
      });
      throw wrapError(err, "创建 WebDAV 客户端失败");
    }
  }

  async ping(): Promise<void> {
    try {
      await this.inner.getDirectoryContents("/");
      logger.debug("webdav ping ok");
    } catch (err) {
      logger.error("webdav ping failed", { error: err });
      throw wrapError(err, "ping 失败");
    }
  }

  async list(path: string): Promise<WebdavFileStat[]> {
    try {
      const contents = await this.inner.getDirectoryContents(normalizePath(path));
      const result = (Array.isArray(contents) ? contents : []).map(mapStat);
      logger.debug("listed directory", { path: normalizePath(path), count: result.length });
      return result;
    } catch (err) {
      logger.error("failed to list directory", { path: normalizePath(path), error: err });
      throw wrapError(err, `列目录失败: ${path}`);
    }
  }

  async get(path: string): Promise<string> {
    try {
      const raw = await this.inner.getFileContents(normalizePath(path), { format: "text" });
      // format:"text" 时返回 string;防御 ResponseDataDetailed 包装形态
      if (typeof raw === "string") {
        logger.debug("read text file", { path: normalizePath(path) });
        return raw;
      }
      if (raw !== null && typeof raw === "object" && "data" in raw && typeof raw.data === "string") {
        logger.debug("read text file", { path: normalizePath(path) });
        return raw.data;
      }
      throw new WebdavError(WebdavErrorCode.UNKNOWN, `读取文件返回了非文本内容: ${path}`);
    } catch (err) {
      if (err instanceof WebdavError) throw err;
      logger.error("failed to read text file", { path: normalizePath(path), error: err });
      throw wrapError(err, `读取文件失败: ${path}`);
    }
  }

  async getBinary(path: string): Promise<Buffer> {
    try {
      const raw = await this.inner.getFileContents(normalizePath(path), { format: "binary" });
      // webdav 库 format:"binary" 返回 Buffer/ArrayBuffer/BufferLike,防御 ResponseDataDetailed 包装
      if (Buffer.isBuffer(raw)) {
        logger.debug("read binary file", { path: normalizePath(path) });
        return raw;
      }
      if (raw instanceof ArrayBuffer) {
        logger.debug("read binary file", { path: normalizePath(path) });
        return Buffer.from(raw);
      }
      if (ArrayBuffer.isView(raw)) {
        logger.debug("read binary file", { path: normalizePath(path) });
        return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
      }
      if (raw !== null && typeof raw === "object" && "data" in raw) {
        const buf = toBuffer(raw.data);
        logger.debug("read binary file", { path: normalizePath(path) });
        return buf;
      }
      throw new WebdavError(WebdavErrorCode.UNKNOWN, `读取文件返回了非二进制内容: ${path}`);
    } catch (err) {
      if (err instanceof WebdavError) throw err;
      logger.error("failed to read binary file", { path: normalizePath(path), error: err });
      throw wrapError(err, `读取二进制文件失败: ${path}`);
    }
  }

  async put(path: string, content: string, options?: { overwrite?: boolean }): Promise<void> {
    const overwrite = options?.overwrite ?? true;
    try {
      await this.inner.putFileContents(normalizePath(path), content, { overwrite });
      logger.debug("wrote text file", { path: normalizePath(path), overwrite });
    } catch (err) {
      logger.error("failed to write text file", { path: normalizePath(path), error: err });
      throw wrapError(err, `写入文件失败: ${path}`);
    }
  }

  async putBinary(path: string, content: Buffer, options?: { overwrite?: boolean }): Promise<void> {
    const overwrite = options?.overwrite ?? true;
    try {
      await this.inner.putFileContents(normalizePath(path), content, { overwrite });
      logger.debug("wrote binary file", { path: normalizePath(path), overwrite });
    } catch (err) {
      logger.error("failed to write binary file", { path: normalizePath(path), error: err });
      throw wrapError(err, `写入二进制文件失败: ${path}`);
    }
  }

  async mkdir(path: string): Promise<void> {
    try {
      await this.inner.createDirectory(normalizePath(path));
      logger.debug("created directory", { path: normalizePath(path) });
    } catch (err) {
      logger.error("failed to create directory", { path: normalizePath(path), error: err });
      throw wrapError(err, `创建目录失败: ${path}`);
    }
  }

  async remove(path: string): Promise<void> {
    try {
      await this.inner.deleteFile(normalizePath(path));
      logger.debug("removed", { path: normalizePath(path) });
    } catch (err) {
      logger.error("failed to remove", { path: normalizePath(path), error: err });
      throw wrapError(err, `删除失败: ${path}`);
    }
  }

  async move(from: string, to: string): Promise<void> {
    try {
      await this.inner.moveFile(normalizePath(from), normalizePath(to), { overwrite: true });
      logger.debug("moved", { from: normalizePath(from), to: normalizePath(to) });
    } catch (err) {
      logger.error("failed to move", {
        from: normalizePath(from),
        to: normalizePath(to),
        error: err,
      });
      throw wrapError(err, `移动失败: ${from} -> ${to}`);
    }
  }

  async copy(from: string, to: string): Promise<void> {
    try {
      await this.inner.copyFile(normalizePath(from), normalizePath(to), { overwrite: true });
      logger.debug("copied", { from: normalizePath(from), to: normalizePath(to) });
    } catch (err) {
      logger.error("failed to copy", {
        from: normalizePath(from),
        to: normalizePath(to),
        error: err,
      });
      throw wrapError(err, `复制失败: ${from} -> ${to}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const result = await this.inner.exists(normalizePath(path));
      logger.debug("checked existence", { path: normalizePath(path), exists: result });
      return result;
    } catch (err) {
      logger.error("failed to check existence", { path: normalizePath(path), error: err });
      throw wrapError(err, `检查存在性失败: ${path}`);
    }
  }
}

/** 按配置创建 WebDAV 客户端 */
export function createWebdavClient(config: WebdavConnectionConfig): WebdavClientApi {
  return new WebdavClientImpl(config);
}
