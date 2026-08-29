import { createFfmpegClient } from "@sakurachiyo0v0/ffmpeg";
import { createLogger } from "@sakurachiyo0v0/logger";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { createDir, listDirs, sanitizeSubdir } from "./dirs.js";
import { downloadToFile } from "./download.js";
import { DownloaderError } from "./errors.js";
import type {
  DownloadHistoryRecord,
  DownloadManagerConfig,
  DownloadProgress,
  DownloadResult,
  DownloadTarget,
} from "./types.js";

const logger = createLogger({ namespace: "media-downloader" }).child("manager");

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 安全文件名：去掉非法字符。 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 180);
}

/**
 * 通用媒体下载管理器：目录选择 + 流式下载 + 元数据/封面 + 下载历史。
 * 与具体媒体平台无关——调用方负责拿到「最终媒体 URL + 文件名」。
 */
export class DownloadManager {
  readonly #root: string;
  readonly #userAgent: string;
  readonly #retries: number;
  #history: DownloadHistoryRecord[] = [];

  constructor(config: DownloadManagerConfig) {
    this.#root = config.root;
    this.#userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
    this.#retries = config.retries ?? 2;
    this.#loadHistory();
  }

  get root(): string {
    return this.#root;
  }

  /** 列出 root 下某目录（subdir，相对 root）的直接子目录名。 */
  listDirs(subdir = ""): string[] {
    return listDirs(this.#root, subdir);
  }

  /** 在 root/subdir 下创建子目录，返回其相对 root 的路径。 */
  createDir(subdir: string, name: string): string {
    return createDir(this.#root, subdir, name);
  }

  /** 下载一个目标媒体文件。 */
  async download(
    target: DownloadTarget,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<DownloadResult> {
    const filename = sanitizeFilename(target.filename);
    if (target.url.trim() === "" || filename === "") {
      throw new DownloaderError("INVALID_TARGET", "url and filename are required");
    }
    const safeSub = target.dir !== undefined ? sanitizeSubdir(target.dir.trim()) : "";
    const baseDir = safeSub === "" ? this.#root : join(this.#root, safeSub);
    const filePath = join(baseDir, filename);

    logger.info("download started", { filename, dir: safeSub });
    try {
      await downloadToFile(target.url, filePath, {
        userAgent: this.#userAgent,
        retries: this.#retries,
        ...(onProgress !== undefined ? { onProgress } : {}),
      });
      await this.#writeTags(filePath, target);
      this.#pushHistory({ filename, filePath, status: "done" });
      return { filePath };
    } catch (error) {
      this.#pushHistory({ filename, filePath, status: "error" });
      throw error;
    }
  }

  /** 下载历史（倒序）。 */
  history(): DownloadHistoryRecord[] {
    return [...this.#history];
  }

  /** 清空下载历史。 */
  clearHistory(): void {
    this.#history = [];
    this.#saveHistory();
  }

  /** 删除单条历史记录。 */
  removeHistory(id: string): void {
    this.#history = this.#history.filter((r) => r.id !== id);
    this.#saveHistory();
  }

  /** 外部下载完成后记录一条历史（供不走 `download` 方法的场景复用历史能力）。 */
  record(record: Omit<DownloadHistoryRecord, "id" | "time">): void {
    this.#pushHistory(record);
  }

  #statePath(): string {
    return join(this.#root, ".download-state.json");
  }

  #loadHistory(): void {
    try {
      const p = this.#statePath();
      if (!existsSync(p)) return;
      const raw = JSON.parse(readFileSync(p, "utf8")) as { history?: unknown };
      if (Array.isArray(raw.history)) {
        for (const r of raw.history) {
          if (r === null || typeof r !== "object") continue;
          const rec = r as Record<string, unknown>;
          if (
            typeof rec.filename !== "string" ||
            typeof rec.filePath !== "string" ||
            (rec.status !== "done" && rec.status !== "error")
          ) {
            continue;
          }
          const time =
            typeof rec.time === "string" && !Number.isNaN(Date.parse(rec.time))
              ? rec.time
              : new Date(0).toISOString();
          const id = typeof rec.id === "string" ? rec.id : randomBytes(8).toString("hex");
          this.#history.push({
            id,
            filename: rec.filename,
            filePath: rec.filePath,
            status: rec.status,
            time,
          });
        }
      }
    } catch {
      // 忽略。
    }
  }

  #saveHistory(): void {
    try {
      const p = this.#statePath();
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify({ history: this.#history }), "utf8");
    } catch {
      // 忽略。
    }
  }

  #pushHistory(record: Omit<DownloadHistoryRecord, "id" | "time">): void {
    this.#history.unshift({ ...record, id: randomBytes(8).toString("hex"), time: new Date().toISOString() });
    if (this.#history.length > 100) this.#history.pop();
    this.#saveHistory();
  }

  /** 用 ffmpeg 写入标签 + 内嵌封面；失败不阻断（媒体已落盘）。 */
  async #writeTags(filePath: string, target: DownloadTarget): Promise<void> {
    const { tags, coverUrl } = target;
    const hasTags =
      tags !== undefined && (tags.title !== undefined || tags.artist !== undefined || tags.album !== undefined);
    if (!hasTags && coverUrl === undefined) return;

    try {
      let coverPath: string | undefined;
      if (coverUrl !== undefined && coverUrl !== "") {
        coverPath = join(tmpdir(), `md-cover-${randomBytes(4).toString("hex")}.jpg`);
        await downloadToFile(coverUrl, coverPath, { userAgent: this.#userAgent, retries: 1 });
      }

      const tmpOut = join(tmpdir(), `md-tag-${randomBytes(4).toString("hex")}${extname(filePath)}`);
      const ffmpeg = createFfmpegClient();
      const result = await ffmpeg.writeTags({
        input: filePath,
        output: tmpOut,
        ...(tags?.title !== undefined ? { title: tags.title } : {}),
        ...(tags?.artist !== undefined ? { artist: tags.artist } : {}),
        ...(tags?.album !== undefined ? { album: tags.album } : {}),
        ...(coverPath !== undefined ? { cover: coverPath } : {}),
        overwrite: true,
      });
      if (result.exitCode === 0 && existsSync(tmpOut)) {
        copyFileSync(tmpOut, filePath);
      }
      rmSync(tmpOut, { force: true });
      if (coverPath !== undefined) rmSync(coverPath, { force: true });
    } catch {
      // 标签/封面写入失败不阻断下载。
    }
  }
}
