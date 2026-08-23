/**
 * 文件下载 —— 支持从任意 URL(含 S3 预签名直链)下载单个文件。
 * 免费商品领取后得到 downloadables → 302 → S3 直链,直接流式下载;
 * 文件名优先从 URL pathname / Content-Disposition 提取。
 * 支持重试、限速、进度回调与幂等跳过。
 */
import { createWriteStream, mkdirSync, statSync, renameSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { BoothError, checkApiResponse } from "../errors.js";
import type { DownloadProgress } from "../types.js";
import type { BoothSession } from "../session.js";

export interface DownloadUrlOptions {
  /** 输出目录(默认当前目录)。 */
  outputDir?: string;
  /** 指定输出文件名(默认从 URL/Content-Disposition 推导)。 */
  fileName?: string;
  /** 已知文件大小(跳过判断用)。 */
  sizeBytes?: number;
  retries?: number;
  rateLimitBps?: number;
  skipExisting?: boolean;
  onProgress?: (progress: DownloadProgress) => void;
}

/** 清理文件名中不安全字符。 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "_").trim();
}

/** 从 URL 提取文件名(basename,URL 解码)。 */
export function fileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const base = basename(pathname);
    if (base !== "" && base !== "/") {
      try {
        return decodeURIComponent(base);
      } catch {
        return base;
      }
    }
  } catch {
    // 无效 URL,回退。
  }
  return `download_${Math.random().toString(36).slice(2, 10)}`;
}

/** 从 Content-Disposition 响应头提取文件名。 */
export function fileNameFromDisposition(header: string | null): string | undefined {
  if (header === null) {
    return undefined;
  }
  const filenameUtf8 = /filename\*=(?:UTF-8''|utf-8'')([^;]+)/i.exec(header);
  if (filenameUtf8?.[1] !== undefined) {
    try {
      return decodeURIComponent(filenameUtf8[1].trim().replace(/^"|"$/g, ""));
    } catch {
      // 回退普通 filename。
    }
  }
  const filename = /filename="?([^";]+)"?/i.exec(header);
  return filename?.[1] !== undefined ? filename[1].trim() : undefined;
}

/** 文件下载器。 */
export class DownloadApi {
  readonly #session: BoothSession;

  constructor(session: BoothSession) {
    this.#session = session;
  }

  /**
   * 下载单个 URL 到 outputDir。返回绝对路径。
   * 重试(retries)、限速(rateLimitBps)、进度(onProgress)、幂等跳过(skipExisting)。
   */
  async downloadUrl(url: string, options: DownloadUrlOptions = {}): Promise<string> {
    const dir = resolve(options.outputDir ?? ".");
    mkdirSync(dir, { recursive: true });
    const fileName = sanitizeFilename(options.fileName ?? fileNameFromUrl(url));
    const outPath = join(dir, fileName);

    if (options.skipExisting !== false) {
      try {
        const existing = statSync(outPath);
        if (existing.size > 0 && (options.sizeBytes === undefined || existing.size === options.sizeBytes)) {
          return outPath;
        }
      } catch {
        // 文件不存在,继续下载。
      }
    }

    const retries = options.retries ?? 2;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await this.#downloadOnce(url, outPath, options);
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await delay(500 * (attempt + 1));
        }
      }
    }
    throw new BoothError(
      "DOWNLOAD_FAILED",
      lastError instanceof Error ? `download failed: ${lastError.message}` : "download failed",
      { fileName },
    );
  }

  async #downloadOnce(url: string, outPath: string, options: DownloadUrlOptions): Promise<string> {
    const response = await this.#session.request(url, { method: "GET" });
    checkApiResponse(response, {
      ...(options.fileName !== undefined ? { fileName: options.fileName } : {}),
    });

    if (response.body === null) {
      throw new BoothError("DOWNLOAD_FAILED", "empty response body", {
        ...(options.fileName !== undefined ? { fileName: options.fileName } : {}),
      });
    }

    // Content-Disposition 文件名优先于 URL 推导;下载完成后 rename。
    const dispositionName = fileNameFromDisposition(response.headers.get("content-disposition"));
    const finalOutPath =
      dispositionName !== undefined && dispositionName !== "" && options.fileName === undefined
        ? join(resolve(options.outputDir ?? "."), sanitizeFilename(dispositionName))
        : outPath;
    if (finalOutPath !== outPath) {
      mkdirSync(resolve(options.outputDir ?? "."), { recursive: true });
    }

    const total = Number(response.headers.get("content-length") ?? options.sizeBytes ?? 0);
    const onProgress = options.onProgress;

    let received = 0;
    const source = response.body;
    const writer = createWriteStream(outPath);

    const reader = async (): Promise<void> => {
      const rateLimit = options.rateLimitBps;
      const readerStream = source as unknown as AsyncIterable<Uint8Array>;
      try {
        for await (const chunk of readerStream) {
          if (!writer.write(chunk)) {
            await new Promise<void>((res) => writer.once("drain", res));
          }
          received += chunk.byteLength;
          onProgress?.({ fileName: basename(outPath), received, total });
          if (rateLimit !== undefined && rateLimit > 0) {
            const pauseMs = Math.max(1, Math.round((chunk.byteLength / rateLimit) * 1000));
            await delay(pauseMs);
          }
        }
        writer.end();
      } catch (error) {
        // 读取失败:取消响应体避免连接挂起,再抛出。
        await source.cancel().catch(() => undefined);
        throw error;
      }
    };

    try {
      await Promise.all([
        reader(),
        new Promise<void>((res, rej) => {
          writer.on("finish", res);
          writer.on("error", rej);
        }),
      ]);
    } finally {
      writer.destroy();
    }

    if (finalOutPath !== outPath) {
      try {
        renameSync(outPath, finalOutPath);
      } catch {
        // rename 失败(如跨设备):保留原名。
        return resolve(outPath);
      }
    }
    return resolve(finalOutPath);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
