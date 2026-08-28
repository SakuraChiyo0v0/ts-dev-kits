import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AuthStore, type AuthPayload } from "@sakurachiyo0v0/account";
import { createFfmpegClient } from "@sakurachiyo0v0/ffmpeg";
import { createLogger, timed } from "@sakurachiyo0v0/logger";
import { bilibiliQrAdapter, type BilibiliCredentials } from "./auth/index.js";
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
import { StreamResolverImpl, selectBestAudioStream, selectBestStream } from "./streams.js";
import { parseUrl } from "./url.js";
import {
  FavApi,
  RelationApi,
  TagApi,
  InteractionApi,
  CommentApi,
  DanmakuApi,
  DynamicApi,
  DataApi,
  CreativeApi,
  UserApi,
} from "./api/index.js";
import type {
  BilibiliClientOptions,
  DownloadProgress,
  ListParseOptions,
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
  /** @timed 装饰器使用的 logger 实例(约定属性)。 */
  readonly logger = createLogger({ namespace: "bilibili" });
  readonly #session: ApiSession;
  readonly #parsers: Map<string, Parser>;
  readonly #streamResolver: StreamResolver;
  readonly #options: Required<Pick<BilibiliClientOptions, "merge">> &
    Pick<BilibiliClientOptions, "download">;
  #fav: FavApi | undefined;
  #relation: RelationApi | undefined;
  #tag: TagApi | undefined;
  #interaction: InteractionApi | undefined;
  #comment: CommentApi | undefined;
  #danmaku: DanmakuApi | undefined;
  #dynamic: DynamicApi | undefined;
  #data: DataApi | undefined;
  #creative: CreativeApi | undefined;
  #user: UserApi | undefined;

  constructor(options: BilibiliClientOptions = {}) {
    // 显式 cookie 优先;未传时从登录态存储自动加载(复用 account 底座)。
    const adapter = bilibiliQrAdapter();
    let cookie = options.cookie;
    let authStore: AuthStore | undefined;
    let credentials: BilibiliCredentials | null = null;
    if (cookie === undefined) {
      authStore = new AuthStore({
        platform: "bilibili",
        ...(options.authPath !== undefined ? { path: options.authPath } : {}),
        ...(options.remote !== undefined ? { remote: options.remote } : {}),
      });
      let payload = authStore.loadSync();
      if (payload === null && authStore.exists()) {
        // 兼容老格式(bilibili-auth AuthData 顶层字段):迁移为新 AuthPayload 并写回。
        payload = migrateLegacyAuthFile(authStore.path);
      }
      credentials =
        payload === null ? null : (adapter.deserialize(payload) as BilibiliCredentials | null);
      cookie = credentials?.cookies;
    }
    this.#session = new ApiSession({
      ...(cookie !== undefined ? { cookie } : {}),
      ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      ...(options.vcBaseUrl !== undefined ? { vcBaseUrl: options.vcBaseUrl } : {}),
      ...(options.memberBaseUrl !== undefined ? { memberBaseUrl: options.memberBaseUrl } : {}),
    });
    if (authStore !== undefined && credentials !== null) {
      // 登录态失效(-101)时自动续期一次并重试。
      const store = authStore;
      this.#session.onAuthFailure = async () => {
        const current = credentials;
        if (current === null) return false;
        try {
          const refreshed = (await adapter.refresh?.(current, fetch)) as
            | BilibiliCredentials
            | undefined;
          if (refreshed === undefined) return false;
          this.#session.setCookie(refreshed.cookies);
          await store.save(adapter.serialize(refreshed, new Date().toISOString()));
          credentials = refreshed;
          return true;
        } catch {
          return false;
        }
      };
    }
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

  /** 当前是否已登录(有 SESSDATA cookie)。 */
  get isLoggedIn(): boolean {
    return this.#session.currentMid() !== undefined;
  }

  /** 当前登录用户 mid(未登录为 undefined)。 */
  get currentMid(): number | undefined {
    return this.#session.currentMid();
  }

  #registerParser(parser: Parser): void {
    this.#parsers.set(parser.type, parser);
  }

  /** 收藏夹管理 API(创建/编辑/删除收藏夹、收藏内容操作、查询)。 */
  get fav(): FavApi {
    this.#fav ??= new FavApi(this.#session);
    return this.#fav;
  }

  /** 关注关系 API(关注/取关/批量关注、列表、拉黑、关系统计)。 */
  get relation(): RelationApi {
    this.#relation ??= new RelationApi(this.#session);
    return this.#relation;
  }

  /** 关注分组 API(分组列表/明细、创建/重命名/删除分组、用户分组操作)。 */
  get tag(): TagApi {
    this.#tag ??= new TagApi(this.#session);
    return this.#tag;
  }

  /** 视频互动 API(点赞/投币/一键三连/点赞状态)。 */
  get interaction(): InteractionApi {
    this.#interaction ??= new InteractionApi(this.#session);
    return this.#interaction;
  }

  /** 评论 API(列表/发表/删除/点赞/置顶)。 */
  get comment(): CommentApi {
    this.#comment ??= new CommentApi(this.#session);
    return this.#comment;
  }

  /** 弹幕 API(发送/获取列表)。 */
  get danmaku(): DanmakuApi {
    this.#danmaku ??= new DanmakuApi(this.#session);
    return this.#danmaku;
  }

  /** 动态 API(发布/删除/点赞/置顶/转发)。 */
  get dynamic(): DynamicApi {
    this.#dynamic ??= new DynamicApi(this.#session);
    return this.#dynamic;
  }

  /** 个人数据 API(稍后再看/历史记录)。 */
  get data(): DataApi {
    this.#data ??= new DataApi(this.#session);
    return this.#data;
  }

  /** 创作中心与追番 API(稿件列表/分P信息/追番追剧)。 */
  get creative(): CreativeApi {
    this.#creative ??= new CreativeApi(this.#session);
    return this.#creative;
  }

  /** 用户信息 API(只读:昵称/签名/粉丝/关注/等级)。 */
  get user(): UserApi {
    this.#user ??= new UserApi(this.#session);
    return this.#user;
  }

  /** 解析任意 B 站链接,返回媒体项列表。 */
  @timed()
  async parse(url: string, options?: ListParseOptions): Promise<MediaItem[]> {
    const parsed = parseUrl(url);
    const parser = this.#parsers.get(parsed.type);
    if (parser === undefined) {
      throw new BilibiliError(
        "UNSUPPORTED_TYPE",
        `Parser for type "${parsed.type}" not implemented yet (planned for v2)`,
      );
    }
    return parser.parse(url, options);
  }

  /** 获取媒体项的播放流。 */
  @timed()
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
  @timed()
  async download(item: MediaItem, options: DownloadOptions): Promise<string> {
    const merge = options.merge ?? this.#options.merge;

    // 音频项:直接下载音频流,不合并。
    if (item.type === "audio") {
      const streams = await this.getStreams(item);
      const audioStream = selectBestAudioStream(streams.audioStreams);
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
    const audioStream = selectBestAudioStream(streams.audioStreams);
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

/**
 * 兼容老格式 auth.json(bilibili-auth 的 AuthData:顶层 cookies/refreshToken 字段),
 * 迁移为新 AuthPayload 并原子写回。返回新 payload;文件不存在/不是老格式返回 null。
 */
function migrateLegacyAuthFile(filePath: string): AuthPayload | null {
  let text: string;
  try {
    text = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  const record = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >;
  if (
    typeof record.cookies !== "string" ||
    record.cookies === "" ||
    typeof record.refreshToken !== "string" ||
    record.refreshToken === ""
  ) {
    return null;
  }
  const payload: AuthPayload = {
    platform: "bilibili",
    credentials: {
      cookies: record.cookies,
      refreshToken: record.refreshToken,
      ...(typeof record.buvid3 === "string" && record.buvid3 !== ""
        ? { buvid3: record.buvid3 }
        : {}),
    },
    savedAt: typeof record.savedAt === "string" ? record.savedAt : new Date().toISOString(),
    ...(typeof record.expiresAt === "string" && record.expiresAt !== ""
      ? { expiresAt: record.expiresAt }
      : {}),
  };
  // 原子写回新格式(tmp + rename),失败不阻塞(下次 login 会重写)。
  try {
    const dir = path.dirname(filePath);
    mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
    renameSync(tmp, filePath);
  } catch {
    // 写回失败仅影响下次读取,忽略。
  }
  return payload;
}
