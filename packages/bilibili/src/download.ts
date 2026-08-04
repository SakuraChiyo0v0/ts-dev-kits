import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { BilibiliError } from "./errors.js";
import type { DownloadConfig, DownloadProgress, MediaStream } from "./types.js";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const PERMANENT_STATUS = new Set([400, 401, 403, 404, 405, 410, 416]);
// 过滤劣质 P2P CDN。mcdn(media CDN)是 B 站正常媒体 CDN,不能过滤。
const PCDN_BLACKLIST = ["pcdn", "szbdyd.com", "mountaintoys.cn"];

/** 下载器配置默认值。 */
export const DEFAULT_DOWNLOAD_CONFIG: Required<DownloadConfig> = {
  concurrency: 4,
  chunkSize: 4 * 1024 * 1024,
  retries: 5,
  speedLimitMbps: 0,
  resume: true,
  filterPcdn: true,
  timeoutSeconds: 10,
};

/** 过滤劣质 CDN 链接。 */
export function filterPcdnUrls(urls: string[]): string[] {
  return urls.filter((url) => !PCDN_BLACKLIST.some((domain) => url.includes(domain)));
}

/** 探测 URL 的文件大小(HEAD 优先,回退 Range GET)。返回 null 表示不可用。 */
async function probeUrlSize(
  url: string,
  referer: string,
  userAgent: string,
  timeoutMs: number,
  minFileSize = 1024,
): Promise<number | null> {
  try {
    const head = await fetch(url, {
      method: "HEAD",
      headers: { referer, "user-agent": userAgent },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (head.status === 405) {
      return await probeRangeGet(url, referer, userAgent, timeoutMs, minFileSize);
    }
    if (!head.ok) {
      // HEAD 可能不被 CDN 支持(如 B 站 mcdn 返回 404),回退到 GET Range 探测。
      return await probeRangeGet(url, referer, userAgent, timeoutMs, minFileSize);
    }
    const size = extractSize(head.headers);
    if (size !== null && size > minFileSize) {
      return size;
    }
    return await probeRangeGet(url, referer, userAgent, timeoutMs, minFileSize);
  } catch {
    return null;
  }
}

async function probeRangeGet(
  url: string,
  referer: string,
  userAgent: string,
  timeoutMs: number,
  minFileSize: number,
): Promise<number | null> {
  try {
    const response = await fetch(url, {
      headers: { referer, "user-agent": userAgent, range: "bytes=0-0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return null;
    }
    const size = extractSize(response.headers);
    return size !== null && size > minFileSize ? size : null;
  } catch {
    return null;
  }
}

function extractSize(headers: Headers): number | null {
  const contentType = (headers.get("content-type") ?? "").toLowerCase();
  if (contentType === "" || contentType.includes("text") || contentType.includes("json")) {
    return null;
  }
  const contentRange = headers.get("content-range") ?? "";
  const total = contentRange.split("/").pop()?.trim() ?? "";
  if (total !== "" && /^\d+$/u.test(total)) {
    return Number(total);
  }
  const contentLength = headers.get("content-length") ?? "";
  if (/^\d+$/u.test(contentLength)) {
    return Number(contentLength);
  }
  return null;
}

/** 从候选 URL 列表解析出可用下载链接。 */
export async function resolveDownloadUrl(
  urls: string[],
  options: {
    referer: string;
    userAgent: string;
    timeoutSeconds: number;
    filterPcdn: boolean;
  },
): Promise<{ url: string; fileSize: number }> {
  const candidates = options.filterPcdn ? filterPcdnUrls(urls) : [...urls];
  for (const url of candidates) {
    const size = await probeUrlSize(
      url,
      options.referer,
      options.userAgent,
      options.timeoutSeconds * 1000,
    );
    if (size !== null) {
      return { url, fileSize: size };
    }
  }
  throw new BilibiliError("DOWNLOAD_FAILED", "No valid download URL found");
}

/** 限速令牌桶。 */
class TokenBucket {
  #rate: number;
  #tokens: number;
  #lastUpdate = Date.now();

  constructor(rate: number) {
    this.#rate = rate;
    this.#tokens = rate;
  }

  async consume(amount: number): Promise<void> {
    if (this.#rate <= 0) {
      return;
    }
    const now = Date.now();
    const elapsed = (now - this.#lastUpdate) / 1000;
    this.#lastUpdate = now;
    this.#tokens = Math.min(this.#rate, this.#tokens + elapsed * this.#rate);
    this.#tokens -= amount;
    if (this.#tokens < 0) {
      const waitMs = (-this.#tokens / this.#rate) * 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 5000)));
    }
  }
}

/** 下载单个流到文件,支持并发分块。 */
export async function downloadStream(
  stream: MediaStream,
  filePath: string,
  options: {
    referer: string;
    userAgent: string;
    config: DownloadConfig;
    onProgress?: (progress: DownloadProgress) => void;
  },
): Promise<number> {
  const config = { ...DEFAULT_DOWNLOAD_CONFIG, ...options.config };
  const { url, fileSize } = await resolveDownloadUrl(stream.urls, {
    referer: options.referer,
    userAgent: options.userAgent,
    timeoutSeconds: config.timeoutSeconds,
    filterPcdn: config.filterPcdn,
  });

  mkdirSync(filePath.split(/[/\\]/u).slice(0, -1).join("/") || ".", { recursive: true });

  // 断点续传:文件已存在且大小匹配则跳过。
  if (config.resume && existsSync(filePath) && statSync(filePath).size >= fileSize) {
    options.onProgress?.({
      downloaded: fileSize,
      total: fileSize,
      percent: 100,
      speed: 0,
      stage: "video",
    });
    return fileSize;
  }

  const concurrency = Math.max(1, config.concurrency);
  if (concurrency <= 1 || fileSize <= config.chunkSize) {
    return downloadSingle(url, filePath, options, config, fileSize);
  }
  return downloadChunked(url, filePath, options, config, fileSize, concurrency);
}

async function downloadSingle(
  url: string,
  filePath: string,
  options: {
    referer: string;
    userAgent: string;
    onProgress?: (progress: DownloadProgress) => void;
  },
  config: Required<DownloadConfig>,
  total: number,
): Promise<number> {
  const tokenBucket = new TokenBucket(config.speedLimitMbps * 1024 * 1024);
  let downloaded = 0;
  let lastReport = 0;
  const start = Date.now();

  for (let attempt = 0; attempt <= config.retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { referer: options.referer, "user-agent": options.userAgent },
        signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
      });
      if (!response.ok) {
        throw new BilibiliError("DOWNLOAD_FAILED", `HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new BilibiliError("DOWNLOAD_FAILED", "No response body");
      }
      const writeStream = createWriteStream(filePath);
      const webStream = response.body as unknown as AsyncIterable<Uint8Array>;
      for await (const chunk of webStream) {
        await tokenBucket.consume(chunk.byteLength);
        downloaded += chunk.byteLength;
        writeStream.write(chunk);
        const now = Date.now();
        if (now - lastReport > 500) {
          lastReport = now;
          const elapsed = (now - start) / 1000;
          options.onProgress?.({
            downloaded,
            total,
            percent: total > 0 ? (downloaded / total) * 100 : 0,
            speed: elapsed > 0 ? downloaded / elapsed : 0,
            stage: "video",
          });
        }
      }
      await new Promise<void>((resolve, reject) => {
        writeStream.end((error?: Error | null) => (error ? reject(error) : resolve()));
      });
      options.onProgress?.({ downloaded: total, total, percent: 100, speed: 0, stage: "video" });
      return downloaded;
    } catch (error) {
      if (attempt >= config.retries) {
        throw new BilibiliError("DOWNLOAD_FAILED", `Download failed after ${config.retries + 1} attempts`, {
          cause: error,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt * 500, 8000)));
    }
  }
  throw new BilibiliError("DOWNLOAD_FAILED", "Download failed");
}

/** 并发分块下载。 */
async function downloadChunked(
  url: string,
  filePath: string,
  options: {
    referer: string;
    userAgent: string;
    onProgress?: (progress: DownloadProgress) => void;
  },
  config: Required<DownloadConfig>,
  total: number,
  concurrency: number,
): Promise<number> {
  const tokenBucket = new TokenBucket(config.speedLimitMbps * 1024 * 1024);
  const chunks = Math.ceil(total / config.chunkSize);
  const written = new Array<number>(chunks).fill(0);
  let completed = 0;
  let downloadedTotal = 0;
  const start = Date.now();

  // 预分配文件。
  const { open } = await import("node:fs/promises");
  const fileHandle = await open(filePath, "w");
  await fileHandle.truncate(total);
  await fileHandle.close();

  const worker = async (chunkIndex: number): Promise<void> => {
    const rangeStart = chunkIndex * config.chunkSize;
    const rangeEnd = Math.min(rangeStart + config.chunkSize, total) - 1;
    let chunkDownloaded = 0;
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            referer: options.referer,
            "user-agent": options.userAgent,
            range: `bytes=${rangeStart}-${rangeEnd}`,
          },
          signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
        });
        if (!response.ok) {
          if (PERMANENT_STATUS.has(response.status)) {
            throw new BilibiliError("DOWNLOAD_FAILED", `HTTP ${response.status}`);
          }
          if (!RETRYABLE_STATUS.has(response.status) && response.status < 500) {
            throw new BilibiliError("DOWNLOAD_FAILED", `HTTP ${response.status}`);
          }
          throw new Error(`Retryable HTTP ${response.status}`);
        }
        if (!response.body) {
          throw new Error("No body");
        }
        const { open: openWrite } = await import("node:fs/promises");
        const handle = await openWrite(filePath, "r+");
        try {
          let position = rangeStart;
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            await tokenBucket.consume(chunk.byteLength);
            await handle.write(chunk, 0, chunk.byteLength, position);
            position += chunk.byteLength;
            chunkDownloaded += chunk.byteLength;
            written[chunkIndex] = chunkDownloaded;
          }
        } finally {
          await handle.close();
        }
        break;
      } catch (error) {
        if (attempt >= config.retries) {
          throw new BilibiliError("DOWNLOAD_FAILED", `Chunk ${chunkIndex + 1} failed`, { cause: error });
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt * 500, 8000)));
      }
    }
  };

  // 并发执行。
  let nextChunk = 0;
  const runners: Array<Promise<void>> = [];
  const runLoop = async (): Promise<void> => {
    while (nextChunk < chunks) {
      const index = nextChunk;
      nextChunk++;
      await worker(index);
      completed++;
      downloadedTotal = written.reduce((sum, value) => sum + value, 0);
      const elapsed = (Date.now() - start) / 1000;
      options.onProgress?.({
        downloaded: downloadedTotal,
        total,
        percent: total > 0 ? (downloadedTotal / total) * 100 : 0,
        speed: elapsed > 0 ? downloadedTotal / elapsed : 0,
        stage: "video",
      });
    }
  };
  for (let i = 0; i < concurrency; i++) {
    runners.push(runLoop());
  }
  await Promise.all(runners);

  options.onProgress?.({ downloaded: total, total, percent: 100, speed: 0, stage: "video" });
  return total;
}
