/**
 * 下载核心:权限预检 → 取流 → 试听拦截(硬规则)→ 下载 → 标签/歌词/封面落盘。
 *
 * 合规红线(用户明确要求):
 *   - 试听 = 拒绝:任何试听特征(freeTrialInfo / 时长明显短于完整时长)一律拒绝落盘;
 *   - 品质必须与账号身份匹配:目标品质不在权限清单内 → PRIVILEGE_DENIED,不降级不绕行。
 */
import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { createFfmpegClient } from "@sakurachiyo0v0/ffmpeg";
import { NeteaseError } from "../errors.js";
import type {
  DownloadConfig,
  DownloadProgress,
  DownloadResult,
  MediaItem,
  QualityLevel,
  SongInfo,
  StreamInfo,
} from "../types.js";
import { SongApi } from "../api/song.js";
import { LyricApi } from "../api/playlist.js";

/** 试听判定:时长占比低于该值视为试听片段。 */
const TRIAL_DURATION_RATIO = 0.9;

/** 默认下载配置。 */
export const DEFAULT_DOWNLOAD_CONFIG: Required<DownloadConfig> = {
  concurrency: 1,
  retries: 3,
  outputDir: ".",
};

/** 校验目标品质是否在权限清单内;不在则抛 PRIVILEGE_DENIED。 */
export function assertLevelAllowed(
  id: string,
  level: QualityLevel,
  availableLevels: QualityLevel[],
): void {
  if (!availableLevels.includes(level)) {
    throw new NeteaseError(
      "PRIVILEGE_DENIED",
      `song ${id}: level "${level}" not allowed for current account (available: ${
        availableLevels.length > 0 ? availableLevels.join(", ") : "none"
      })`,
    );
  }
}

/** 试听拦截:命中试听特征抛 TRIAL_ONLY,绝不落盘。 */
export function assertNotTrial(
  id: string,
  stream: StreamInfo,
  expectedDurationMs: number | undefined,
): void {
  if (stream.isTrial) {
    throw new NeteaseError(
      "TRIAL_ONLY",
      `song ${id}: server returned a trial fragment (freeTrialInfo), refusing to download an incomplete audio`,
    );
  }
  if (
    expectedDurationMs !== undefined &&
    expectedDurationMs > 0 &&
    stream.durationMs !== undefined &&
    stream.durationMs > 0 &&
    stream.durationMs < expectedDurationMs * TRIAL_DURATION_RATIO
  ) {
    throw new NeteaseError(
      "TRIAL_ONLY",
      `song ${id}: stream duration (${stream.durationMs}ms) is far shorter than full song (${expectedDurationMs}ms), refusing trial fragment`,
    );
  }
}

/** 安全文件名(去非法字符)。 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120);
}

/** 单曲下载器。 */
export class SongDownloader {
  readonly #songs: SongApi;
  readonly #lyrics: LyricApi;
  readonly #config: Required<DownloadConfig>;
  readonly #userAgent: string;

  constructor(
    songs: SongApi,
    lyrics: LyricApi,
    config: DownloadConfig,
    userAgent: string,
  ) {
    this.#songs = songs;
    this.#lyrics = lyrics;
    this.#config = { ...DEFAULT_DOWNLOAD_CONFIG, ...config };
    this.#userAgent = userAgent;
  }

  /**
   * 下载一首歌。
   * @param item 歌曲 MediaItem(song 类型)
   * @param options 下载选项
   */
  async download(
    item: MediaItem,
    options: {
      outputDir?: string;
      level?: QualityLevel;
      lyric?: boolean;
      lyricMode?: "original" | "translated" | "both";
      cover?: boolean;
      writeTags?: boolean;
      onProgress?: (progress: DownloadProgress) => void;
    },
  ): Promise<DownloadResult> {
    const level = options.level ?? "exhigh";
    const outputDir = options.outputDir ?? this.#config.outputDir;
    const wantLyric = options.lyric ?? true;
    const lyricMode = options.lyricMode ?? "both";
    const wantCover = options.cover ?? true;
    const wantTags = options.writeTags ?? true;

    // 1. 歌曲信息(标题/歌手/专辑/时长/封面)。
    let songInfo: SongInfo;
    try {
      const details = await this.#songs.getDetail([item.id]);
      const first = details[0];
      if (first === undefined) {
        throw new NeteaseError("NOT_FOUND", `song ${item.id} not found`);
      }
      songInfo = first;
    } catch (error) {
      if (error instanceof NeteaseError) {
        throw error;
      }
      throw new NeteaseError("API_ERROR", `song ${item.id} detail failed`, { cause: error });
    }

    // 2. 权限预检:目标品质必须在账号可请求清单内。
    const privilege = await this.#songs.getPrivilege(item.id);
    assertLevelAllowed(item.id, level, privilege.availableLevels);

    // 3. 取流。
    const [stream] = await this.#songs.getStreams([item.id], level);
    if (stream === undefined) {
      throw new NeteaseError("PRIVILEGE_DENIED", `song ${item.id}: no stream returned`);
    }

    // 4. 试听拦截(硬规则)。
    assertNotTrial(item.id, stream, songInfo.durationMs);

    // 5. 落盘文件名。
    const safeTitle = sanitizeFilename(songInfo.title || item.title || item.id);
    const artists = songInfo.artists.join(",") || "unknown";
    const baseName = `${artists} - ${safeTitle}`;
    const extension = pickExtension(stream.url, level);
    const filePath = joinPath(outputDir, `${baseName}.${extension}`);

    // 6. 下载音频(流式,带重试)。
    await downloadToFile(stream.url, filePath, {
      userAgent: this.#userAgent,
      retries: this.#config.retries,
      onProgress: (downloaded, total) => {
        options.onProgress?.({
          downloaded,
          total,
          percent: total > 0 ? (downloaded / total) * 100 : 0,
          speed: 0,
          itemTitle: songInfo.title,
        });
      },
    });

    // 7. 歌词(LRC)。
    let lyricPath: string | undefined;
    if (wantLyric) {
      try {
        const lyric = await this.#lyrics.getLyric(item.id);
        const text = selectLyric(lyric.original, lyric.translated, lyricMode);
        if (text !== undefined && text !== "") {
          lyricPath = joinPath(outputDir, `${baseName}.lrc`);
          await writeTextFile(lyricPath, text);
        }
      } catch {
        // 歌词缺失/失败不阻断音频下载。
        lyricPath = undefined;
      }
    }

    // 8. 封面 + ID3 标签。
    let coverPath: string | undefined;
    if (wantCover || wantTags) {
      const coverUrl = songInfo.coverUrl;
      if (coverUrl !== undefined && coverUrl !== "") {
        try {
          coverPath = joinPath(outputDir, `${baseName}.jpg`);
          await downloadToFile(coverUrl, coverPath, {
            userAgent: this.#userAgent,
            retries: 1,
          });
        } catch {
          coverPath = undefined;
        }
      }
    }

    if (wantTags && coverPath !== undefined) {
      // 标签 + 内嵌封面:ffmpeg 输出到系统临时目录,再用 copyFile 覆盖最终文件。
      // 不用"同目录临时文件 + renameSync":Windows 的 fuse 挂载目录(如 OneDrive)
      // 上 renameSync 会触发原生崩溃(0xC0000409);copyFile 是流式安全的。
      // 标签写入失败不阻断下载(音频已成功落盘,标签是附加功能)。
      const ffmpeg = createFfmpegClient();
      const taggedPath = await safeWriteTags(
        ffmpeg,
        filePath,
        coverPath,
        songInfo,
        extension,
      );
      if (taggedPath !== undefined) {
        // 覆盖最终文件(流式 copy 安全),再清理临时文件。
        const { copyFileSync, rmSync } = await import("node:fs");
        copyFileSync(taggedPath, filePath);
        rmSync(taggedPath, { force: true });
      }
    } else if (wantTags) {
      // 无封面:仅写文本标签,同样走临时目录 + copyFile(规避 fuse rename 崩溃)。
      const ffmpeg = createFfmpegClient();
      const taggedPath = await safeWriteTags(
        ffmpeg,
        filePath,
        undefined,
        songInfo,
        extension,
      );
      if (taggedPath !== undefined) {
        const { copyFileSync, rmSync } = await import("node:fs");
        copyFileSync(taggedPath, filePath);
        rmSync(taggedPath, { force: true });
      }
    }

    return {
      filePath,
      level: stream.level,
      ...(lyricPath !== undefined ? { lyricPath } : {}),
      ...(coverPath !== undefined ? { coverPath } : {}),
    };
  }
}

/** 根据 URL/品质选扩展名。 */
function pickExtension(url: string, level: QualityLevel): string {
  const pathPart = url.split("?")[0] ?? "";
  const match = /\.([a-z0-9]+)$/iu.exec(pathPart);
  if (match !== null) {
    return match[1]!.toLowerCase();
  }
  return level === "lossless" || level === "hires" ? "flac" : "mp3";
}

/** 拼接路径(兼容 Windows 分隔符)。 */
function joinPath(dir: string, file: string): string {
  return dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${file}` : `${dir}/${file}`;
}

/** 选择歌词文本。 */
function selectLyric(
  original: string | undefined,
  translated: string | undefined,
  mode: "original" | "translated" | "both",
): string | undefined {
  if (mode === "original") {
    return original;
  }
  if (mode === "translated") {
    return translated ?? original;
  }
  // both:原文在上、翻译在下逐行交错过于复杂,采用"原文 + 翻译"拼接。
  if (original !== undefined && translated !== undefined && translated !== original) {
    return `${original}\n\n${translated}`;
  }
  return original ?? translated;
}

/**
 * 用 ffmpeg 把标签+封面写入系统临时目录的同名文件,返回临时路径。
 * 成功(exit 0 且产物存在)返回路径;任何失败(ffmpeg 抛错/非零退出)返回 undefined。
 */
async function safeWriteTags(
  ffmpeg: ReturnType<typeof createFfmpegClient>,
  sourcePath: string,
  coverPath: string | undefined,
  songInfo: SongInfo,
  extension: string,
): Promise<string | undefined> {
  try {
    return await writeTagsToTemp(ffmpeg, sourcePath, coverPath, songInfo, extension);
  } catch {
    return undefined;
  }
}

/**
 * 用 ffmpeg 把标签+封面写入系统临时目录的同名文件,返回临时路径。
 * 成功(exit 0 且产物存在)返回路径;失败返回 undefined(调用方决定是否抛错)。
 */
async function writeTagsToTemp(
  ffmpeg: ReturnType<typeof createFfmpegClient>,
  sourcePath: string,
  coverPath: string | undefined,
  songInfo: SongInfo,
  extension: string,
): Promise<string | undefined> {
  const { tmpdir } = await import("node:os");
  const { randomBytes } = await import("node:crypto");
  const { join } = await import("node:path");
  const { existsSync } = await import("node:fs");
  const suffix = randomBytes(4).toString("hex");
  const taggedPath = join(tmpdir(), `sc-tag-${suffix}.${extension}`);
  const result = await ffmpeg.writeTags({
    input: sourcePath,
    output: taggedPath,
    ...(songInfo.title !== "" ? { title: songInfo.title } : {}),
    ...(songInfo.artists.length > 0 ? { artist: songInfo.artists.join("/") } : {}),
    ...(songInfo.album !== "" ? { album: songInfo.album } : {}),
    ...(coverPath !== undefined ? { cover: coverPath } : {}),
    overwrite: true,
  });
  if (result.exitCode !== 0 || !existsSync(taggedPath)) {
    return undefined;
  }
  return taggedPath;
}

/** 流式下载到文件(带重试)。 */
async function downloadToFile(
  url: string,
  filePath: string,
  options: {
    userAgent: string;
    retries: number;
    onProgress?: (downloaded: number, total: number) => void;
  },
): Promise<void> {
  const dir = filePath.split(/[/\\]/u).slice(0, -1).join("/") || ".";
  mkdirSync(dir, { recursive: true });

  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": options.userAgent,
          referer: "https://music.163.com/",
        },
      });
      if (!response.ok) {
        throw new NeteaseError("DOWNLOAD_FAILED", `HTTP ${response.status}`);
      }
      if (response.body === null) {
        throw new NeteaseError("DOWNLOAD_FAILED", "empty body");
      }
      const total = Number(response.headers.get("content-length") ?? 0);
      const writeStream = createWriteStream(filePath);
      let downloaded = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value !== undefined) {
          downloaded += value.byteLength;
          writeStream.write(value);
          options.onProgress?.(downloaded, total);
        }
      }
      await new Promise<void>((resolve, reject) => {
        writeStream.end((error?: Error | null) => (error ? reject(error) : resolve()));
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= options.retries) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt * 500, 5000)));
    }
  }
  throw new NeteaseError("DOWNLOAD_FAILED", `download failed after ${options.retries + 1} attempts`, {
    cause: lastError,
  });
}

/** 写文本文件。 */
async function writeTextFile(filePath: string, content: string): Promise<void> {
  const dir = filePath.split(/[/\\]/u).slice(0, -1).join("/") || ".";
  mkdirSync(dir, { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(filePath, content, "utf-8");
}
