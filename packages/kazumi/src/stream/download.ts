import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFfmpegClient } from "@sakurachiyo0v0/ffmpeg";
import { createLogger } from "@sakurachiyo0v0/logger";
import { KazumiError } from "../errors.js";
import type { DownloadOptions, DownloadProgress, Episode } from "../types.js";
import type { AnimeRule } from "../types.js";
import { buildLocalM3u8, extractUniqueKeys, parseM3u8 } from "./m3u8.js";
import { filterAds } from "./ad-filter.js";
import { PlaybackResolver } from "./resolver.js";

const logger = createLogger({ namespace: "kazumi" }).child("download");

/** 下载会话:解析 m3u8 → 并发下载分片 → ffmpeg 合并 mp4。 */
export class EpisodeDownloader {
  private readonly fetchImpl: typeof fetch;
  private readonly ffmpeg = createFfmpegClient();

  constructor(
    fetchImpl: typeof fetch = fetch,
    private readonly options: DownloadOptions = {},
    /** 可注入 ffmpeg run(测试用);缺省用真实 ffmpeg。 */
    private readonly ffmpegRun?: (args: string[]) => Promise<unknown>,
  ) {
    this.fetchImpl = fetchImpl;
  }

  async download(
    rule: AnimeRule,
    episode: Episode,
    opts: {
      outputDir: string;
      onProgress?: (progress: DownloadProgress) => void;
      /** 番剧名：提供时文件名用「番剧名.集名.mp4」，否则只用集名。 */
      title?: string;
    },
  ): Promise<{ filePath: string }> {
    const concurrency = this.options.concurrency ?? 4;
    const retries = this.options.retries ?? 3;
    const timeoutMs = this.options.timeoutMs ?? 30_000;
    const adFilter = this.options.adFilter ?? true;

    // 播放页 URL → 直链 m3u8(经 PlaybackResolver 静态递归解析)
    const episodeUrl = episode.url;
    const headers = this.headersFor(rule);
    const resolver = new PlaybackResolver(this.fetchImpl);
    const resolved = await resolver.resolve(episodeUrl, headers, timeoutMs);
    const playlistUrl = resolved.url;

    const rawPlaylist = await this.fetchText(playlistUrl, headers, timeoutMs);
    const parsed = parseM3u8(rawPlaylist);
    let mediaUrl = playlistUrl;
    let mediaContent = rawPlaylist;
    let targetDuration = parsed.media?.targetDuration ?? 0;

    if (parsed.type === "master" && parsed.variants && parsed.variants.length > 0) {
      // 选最高码率变体
      const best = parsed.variants.reduce((a, b) =>
        b.bandwidth > a.bandwidth ? b : a,
      );
      mediaUrl = resolveUrl(playlistUrl, best.uri);
      mediaContent = await this.fetchText(mediaUrl, headers, timeoutMs);
      targetDuration = parseM3u8(mediaContent).media?.targetDuration ?? 0;
    }

    let media = parseM3u8(mediaContent).media;
    if (!media) {
      throw new KazumiError("STREAM_PARSE_FAILED", `m3u8 解析失败: ${playlistUrl}`);
    }
    if (!media.isVod) {
      throw new KazumiError("STREAM_PARSE_FAILED", "不支持下载直播流(无 #EXT-X-ENDLIST)");
    }
    if (media.segments.length === 0) {
      throw new KazumiError("STREAM_PARSE_FAILED", "m3u8 中未找到可下载的分片");
    }
    if (adFilter) {
      media = filterAds(media);
    }

    // 临时工作目录
    const workDir = join(
      tmpdir(),
      `kazumi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workDir, { recursive: true });
    try {
      // 下载加密 key(如有)
      const keys = extractUniqueKeys(media);
      const keyUriToLocal = new Map<string, string>();
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]!;
        const keyFile = `key_${index}.key`;
        const keyPath = join(workDir, keyFile);
        const keyUrl = resolveUrl(mediaUrl, key.uri);
        await this.fetchToFile(keyUrl, keyPath, headers, timeoutMs, retries);
        keyUriToLocal.set(key.uri, keyFile);
      }

      // 并发下载分片
      const segmentNames: string[] = [];
      const baseUrl = mediaUrl;
      let downloadedBytes = 0;
      let speed = 0;
      const startTime = Date.now();

      const queue = media.segments.map((segment, index) => ({ segment, index }));
      let next = 0;
      const results = new Array<boolean>(queue.length).fill(false);

      async function worker(this: EpisodeDownloader): Promise<void> {
        while (true) {
          const jobIndex = next;
          if (jobIndex >= queue.length) return;
          next++;
          const { segment, index } = queue[jobIndex]!;
          const segName = `seg_${String(index).padStart(5, "0")}.ts`;
          segmentNames[index] = segName;
          const segUrl = resolveUrl(baseUrl, segment.uri);
          const segPath = join(workDir, segName);
          try {
            const bytes = await this.fetchToFileWithSize(
              segUrl,
              segPath,
              headers,
              timeoutMs,
              retries,
            );
            downloadedBytes += bytes;
            speed = bytes > 0 ? Math.round((downloadedBytes / (Date.now() - startTime)) * 1000) : 0;
            results[index] = true;
            opts.onProgress?.({
              episodeName: episode.name,
              downloadedBytes,
              totalBytes: null,
              speed,
            });
          } catch (error) {
            logger.warn(`分片下载失败 ${segUrl}`, { error: String(error) });
            results[index] = false;
          }
        }
      }

      const workerCount = Math.max(1, Math.min(concurrency, queue.length));
      await Promise.all(
        Array.from({ length: workerCount }, () => worker.call(this)),
      );

      const failedCount = results.filter((ok) => !ok).length;
      if (failedCount > 0) {
        throw new KazumiError(
          "DOWNLOAD_FAILED",
          `${failedCount} 个分片下载失败`,
        );
      }

      // 构建本地 m3u8(分片/key 指向本地文件)
      const localM3u8 = buildLocalM3u8(
        { ...media, targetDuration: targetDuration || media.targetDuration },
        { segmentNames, keyUriToLocal },
      );
      const m3u8Path = join(workDir, "playlist.m3u8");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(m3u8Path, localM3u8, "utf-8");

      // ffmpeg 合并成 mp4(ffmpeg 处理 AES-128 解密)
      const outputDir = opts.outputDir;
      mkdirSync(outputDir, { recursive: true });
      // 文件名标准化：「番剧名.集名.mp4」（提供剧名时），集名做两位补齐与非法字符清理，
      // 便于导入到媒体库（如「间谍过家家.第01集.mp4」）。
      const cleanEpisodeName = normalizeEpisodeName(episode.name);
      const safeName = (
        opts.title !== undefined && opts.title !== ""
          ? `${sanitizeFilename(opts.title)}.${cleanEpisodeName}`
          : cleanEpisodeName
      )
        .replace(/[\\/:*?"<>|]/g, "_")
        .slice(0, 120);
      const filePath = join(outputDir, `${safeName}.mp4`);
      if (this.ffmpegRun) {
        await this.ffmpegRun([
          "-y",
          "-allowed_extensions",
          "ALL",
          "-i",
          m3u8Path,
          "-c",
          "copy",
          "-bsf:a",
          "aac_adtstoasc",
          filePath,
        ]);
      } else {
        await this.ffmpeg.run(
          [
            "-y",
            "-allowed_extensions",
            "ALL",
            "-i",
            m3u8Path,
            "-c",
            "copy",
            "-bsf:a",
            "aac_adtstoasc",
            filePath,
          ],
          { timeoutMs: 60 * 60 * 1000 },
        );
      }
      logger.info(`合并完成: ${filePath}`);
      return { filePath };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  private headersFor(rule: AnimeRule): Record<string, string> {
    return {
      "user-agent": rule.userAgent || "Mozilla/5.0 (compatible; kazumi-sdk)",
      ...(rule.referer !== "" ? { referer: rule.referer } : {}),
    };
  }

  private async fetchText(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<string> {
    const response = await this.fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!response.ok) {
      throw new KazumiError("NETWORK", `请求失败 ${url} → HTTP ${response.status}`);
    }
    return response.text();
  }

  private async fetchToFile(
    url: string,
    filePath: string,
    headers: Record<string, string>,
    timeoutMs: number,
    retries: number,
  ): Promise<void> {
    await this.fetchToFileWithSize(url, filePath, headers, timeoutMs, retries);
  }

  private async fetchToFileWithSize(
    url: string,
    filePath: string,
    headers: Record<string, string>,
    timeoutMs: number,
    retries: number,
  ): Promise<number> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "follow",
        });
        if (!response.ok) {
          throw new KazumiError(
            "NETWORK",
            `请求失败 ${url} → HTTP ${response.status}`,
          );
        }
        const arrayBuffer = await response.arrayBuffer();
        const { writeFileSync } = await import("node:fs");
        writeFileSync(filePath, Buffer.from(arrayBuffer));
        return arrayBuffer.byteLength;
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }
    throw lastError instanceof KazumiError
      ? lastError
      : new KazumiError("DOWNLOAD_FAILED", `分片下载失败: ${url}`, lastError);
  }
}

/** 相对 URL 基于 base 解析。 */
function resolveUrl(base: string, raw: string): string {
  try {
    return new URL(raw, base).toString();
  } catch {
    return raw;
  }
}

/** 清理文件名中的非法字符（Windows 路径非法字符 + 控制字符）。 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
}

/**
 * 标准化集名：「第3集」→「第03集」（保持两位，方便按字典序排序）、
 * 「第3话」→「第03话」；已两位的保持不变。
 */
export function normalizeEpisodeName(raw: string): string {
  const trimmed = raw.trim();
  // 匹配「第 N 集/话/回/章」等，N 补零到两位。
  const m = /^(第\s*)(\d+)(\s*(?:集|话|回|章|话番|季.*)?)$/.exec(trimmed);
  if (m !== null) {
    const num = m[2]!;
    const zeroPadded = num.length >= 2 ? num : num.padStart(2, "0");
    return `${m[1]}${zeroPadded}${m[3] ?? ""}`.replace(/\s+/g, "");
  }
  return trimmed;
}
