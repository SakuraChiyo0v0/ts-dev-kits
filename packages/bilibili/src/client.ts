import { createFfmpegClient } from "@amechan/ffmpeg";
import { BilibiliError } from "./errors.js";
import { ApiSession } from "./network.js";
import { downloadStream } from "./download.js";
import { VideoParser } from "./parsers/video.js";
import { BangumiParser } from "./parsers/bangumi.js";
import { CheeseParser } from "./parsers/cheese.js";
import { AudioParser } from "./parsers/audio.js";
import {
  CollectionParser,
  FavlistParser,
  HistoryParser,
  PopularParser,
  SpaceParser,
  WatchLaterParser,
} from "./parsers/aggregate.js";
import { StreamResolverImpl, selectBestStream } from "./streams.js";
import { parseUrl } from "./url.js";
import type {
  BilibiliClientOptions,
  DownloadProgress,
  MediaItem,
  MediaStream,
  Parser,
  PlayStream,
  StreamOptions,
  StreamResolver,
} from "./types.js";

export interface DownloadOptions {
  outputDir: string;
  /** 输出文件名(不含扩展名)。默认用标题。 */
  filename?: string;
  quality?: number;
  codec?: StreamOptions["codec"];
  merge?: boolean;
  onProgress?: (progress: DownloadProgress) => void;
}

/** Bilibili 下载客户端。 */
export class BilibiliClient {
  readonly #session: ApiSession;
  readonly #parsers: Map<string, Parser>;
  readonly #streamResolver: StreamResolver;
  readonly #options: Required<Pick<BilibiliClientOptions, "merge">> &
    Pick<BilibiliClientOptions, "download">;

  constructor(options: BilibiliClientOptions = {}) {
    this.#session = new ApiSession({
      ...(options.cookie !== undefined ? { cookie: options.cookie } : {}),
      ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    });
    this.#parsers = new Map();
    this.#registerParser(new VideoParser(this.#session));
    this.#registerParser(new BangumiParser(this.#session));
    this.#registerParser(new CheeseParser(this.#session));
    this.#registerParser(new AudioParser(this.#session));
    this.#registerParser(new SpaceParser(this.#session));
    this.#registerParser(new FavlistParser(this.#session));
    this.#registerParser(new CollectionParser(this.#session));
    this.#registerParser(new PopularParser(this.#session));
    this.#registerParser(new WatchLaterParser(this.#session));
    this.#registerParser(new HistoryParser(this.#session));
    this.#streamResolver = new StreamResolverImpl(this.#session);
    this.#options = {
      merge: options.merge ?? true,
      ...(options.download !== undefined ? { download: options.download } : {}),
    };
  }

  #registerParser(parser: Parser): void {
    this.#parsers.set(parser.type, parser);
  }

  /** 解析任意 B 站链接,返回媒体项列表。 */
  async parse(url: string): Promise<MediaItem[]> {
    const parsed = parseUrl(url);
    const parser = this.#parsers.get(parsed.type);
    if (parser === undefined) {
      throw new BilibiliError(
        "UNSUPPORTED_TYPE",
        `Parser for type "${parsed.type}" not implemented yet (planned for v2)`,
      );
    }
    return parser.parse(url);
  }

  /** 获取媒体项的播放流。 */
  getStreams(item: MediaItem, options?: StreamOptions): Promise<PlayStream> {
    const streamOptions: StreamOptions = {};
    if (options?.quality !== undefined) {
      streamOptions.quality = options.quality;
    }
    if (options?.codec !== undefined) {
      streamOptions.codec = options.codec;
    }
    return this.#streamResolver.getStreams(item, streamOptions);
  }

  /** 下载媒体项(音视频分离下载 + 可选 ffmpeg 合并)。 */
  async download(item: MediaItem, options: DownloadOptions): Promise<string> {
    const merge = options.merge ?? this.#options.merge;

    // 音频项:直接下载音频流,不合并。
    if (item.type === "audio") {
      const streams = await this.getStreams(item);
      const audioStream = selectBestStream(streams.audioStreams, 0);
      if (audioStream === undefined) {
        throw new BilibiliError("DOWNLOAD_FAILED", "No audio stream available");
      }
      const { mkdirSync } = await import("node:fs");
      mkdirSync(options.outputDir, { recursive: true });
      const safeTitle = sanitizeFilename(options.filename ?? item.title);
      const audioPath = `${options.outputDir}/${safeTitle}.m4a`;
      await downloadStream(audioStream, audioPath, {
        referer: "https://www.bilibili.com/",
        userAgent: this.#session.userAgent,
        config: this.#options.download ?? {},
        ...(options.onProgress !== undefined
          ? { onProgress: (progress) => options.onProgress?.({ ...progress, stage: "audio" }) }
          : {}),
      });
      return audioPath;
    }

    const streamOptions: StreamOptions = {};
    if (options.quality !== undefined) {
      streamOptions.quality = options.quality;
    }
    if (options.codec !== undefined) {
      streamOptions.codec = options.codec;
    }
    const streams = await this.getStreams(item, streamOptions);

    const { mkdirSync } = await import("node:fs");
    mkdirSync(options.outputDir, { recursive: true });

    const safeTitle = sanitizeFilename(options.filename ?? item.title);
    const videoPath = `${options.outputDir}/${safeTitle}.m4s`;
    const audioPath = `${options.outputDir}/${safeTitle}.audio.m4s`;

    // 选视频流。
    const videoStream = selectBestStream(streams.videoStreams, options.quality ?? streams.quality, options.codec);
    if (videoStream === undefined) {
      throw new BilibiliError("DOWNLOAD_FAILED", "No video stream available");
    }
    await downloadStream(videoStream, videoPath, {
      referer: "https://www.bilibili.com/",
      userAgent: this.#session.userAgent,
      config: this.#options.download ?? {},
      ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    });

    // 选音频流(DASH 才有)。
    let audioFile: string | undefined;
    const audioStream = selectBestStream(streams.audioStreams, 0);
    if (audioStream !== undefined && merge) {
      await downloadStream(audioStream, audioPath, {
        referer: "https://www.bilibili.com/",
        userAgent: this.#session.userAgent,
        config: this.#options.download ?? {},
        ...(options.onProgress !== undefined
          ? { onProgress: (progress) => options.onProgress?.({ ...progress, stage: "audio" }) }
          : {}),
      });
      audioFile = audioPath;
    }

    // 合并。
    if (audioFile !== undefined) {
      const outputPath = `${options.outputDir}/${safeTitle}.mp4`;
      options.onProgress?.({ downloaded: 0, total: 100, percent: 0, speed: 0, stage: "merging" });
      await mergeWithFfmpeg(videoPath, audioFile, outputPath);
      options.onProgress?.({ downloaded: 100, total: 100, percent: 100, speed: 0, stage: "merging" });
      return outputPath;
    }

    return videoPath;
  }
}

/** 合并音视频流为 mp4。 */
async function mergeWithFfmpeg(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
  try {
    const ffmpeg = createFfmpegClient();
    const result = await ffmpeg.run([
      "-i", videoPath,
      "-i", audioPath,
      "-c", "copy",
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ]);
    if (result.exitCode !== 0) {
      throw new BilibiliError("MERGE_FAILED", `ffmpeg merge failed: ${result.stderr}`);
    }
  } catch (error) {
    if (error instanceof BilibiliError) {
      throw error;
    }
    throw new BilibiliError("MERGE_FAILED", "ffmpeg merge failed", { cause: error });
  }
}

/** 清理文件名中的非法字符。 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/gu, "_").trim() || "video";
}

/** 便捷工厂。 */
export function createBilibiliClient(options?: BilibiliClientOptions): BilibiliClient {
  return new BilibiliClient(options);
}
