import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { DownloaderError } from "./errors.js";
import type { DownloadProgress } from "./types.js";

export interface DownloadToFileOptions {
  userAgent: string;
  retries: number;
  onProgress?: (progress: DownloadProgress) => void;
}

/** 流式下载到文件，带重试与进度回调。失败抛 DownloaderError 并清理残留文件。 */
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
      const reader = response.body.getReader();
      let downloaded = 0;

      await new Promise<void>((resolve, reject) => {
        const writeStream = createWriteStream(filePath);
        // 监听 error，避免磁盘写满等异步错误变成 uncaught exception 崩进程。
        writeStream.on("error", (err) => {
          writeStream.destroy();
          reject(err);
        });
        void (async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value !== undefined) {
                downloaded += value.byteLength;
                if (!writeStream.write(value)) {
                  // 背压：等待 drain 再继续读。
                  await new Promise<void>((res) => writeStream.once("drain", res));
                }
                options.onProgress?.({
                  downloaded,
                  total,
                  percent: total > 0 ? (downloaded / total) * 100 : 0,
                });
              }
            }
            writeStream.end(() => resolve());
          } catch (err) {
            writeStream.destroy();
            reject(err);
          }
        })();
      });
      return;
    } catch (error) {
      lastError = error;
      try {
        rmSync(filePath, { force: true });
      } catch {
        // 忽略清理失败。
      }
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
