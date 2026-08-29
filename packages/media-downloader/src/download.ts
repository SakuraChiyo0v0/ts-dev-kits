import { createWriteStream, mkdirSync } from "node:fs";
import { DownloaderError } from "./errors.js";
import type { DownloadProgress } from "./types.js";

export interface DownloadToFileOptions {
  userAgent: string;
  retries: number;
  onProgress?: (progress: DownloadProgress) => void;
}

/** 流式下载到文件，带重试与进度回调。失败抛 DownloaderError。 */
export async function downloadToFile(
  url: string,
  filePath: string,
  options: DownloadToFileOptions,
): Promise<void> {
  const dir = filePath.split(/[/\\]/u).slice(0, -1).join("/") || ".";
  mkdirSync(dir, { recursive: true });

  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": options.userAgent },
      });
      if (!response.ok) {
        throw new DownloaderError("DOWNLOAD_FAILED", `HTTP ${response.status}`);
      }
      if (response.body === null) {
        throw new DownloaderError("EMPTY_BODY", "empty body");
      }
      const total = Number(response.headers.get("content-length") ?? 0);
      const writeStream = createWriteStream(filePath);
      let downloaded = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value !== undefined) {
          downloaded += value.byteLength;
          writeStream.write(value);
          options.onProgress?.({
            downloaded,
            total,
            percent: total > 0 ? (downloaded / total) * 100 : 0,
          });
        }
      }
      await new Promise<void>((resolve, reject) => {
        writeStream.end((error?: Error | null) => (error ? reject(error) : resolve()));
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= options.retries) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt * 500, 5000)));
    }
  }
  throw new DownloaderError(
    "DOWNLOAD_FAILED",
    `download failed after ${options.retries + 1} attempts`,
    { cause: lastError },
  );
}
