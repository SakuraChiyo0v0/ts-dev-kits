/**
 * NeteaseMusicClient —— 网易云音乐下载 SDK 统一入口。
 * 登录态:显式 cookie 优先,否则从 account AuthStore 自动加载。
 * 合规:权限预检 + 试听拦截在 download 内部强制执行。
 */
import { AuthStore } from "@sakurachiyo0v0/account";
import { NeteaseError } from "./errors.js";
import type {
  DownloadConfig,
  DownloadProgress,
  DownloadResult,
  MediaItem,
  MediaType,
  NeteaseClientOptions,
  QualityLevel,
  SongInfo,
  VipInfo,
} from "./types.js";
import { WeapiSession, type NeteaseCredentials } from "./api/session.js";
import { SongApi } from "./api/song.js";
import { PlaylistApi, LyricApi } from "./api/playlist.js";
import { UserApi, type AccountInfo, type UserPlaylistSummary } from "./api/user.js";
import { SongDownloader } from "./download/stream.js";
import { parseNeteaseUrl, isNeteaseUrl } from "./parsers/url.js";
import { neteaseQrAdapter } from "./auth/adapter.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface DownloadSongOptions {
  outputDir?: string;
  level?: QualityLevel;
  lyric?: boolean;
  lyricMode?: "original" | "translated" | "both";
  cover?: boolean;
  writeTags?: boolean;
  onProgress?: (progress: DownloadProgress) => void;
}

/** 解析结果:歌单/专辑展开为歌曲清单。 */
export interface ParsedMedia {
  /** 原始媒体项(歌单/专辑含 tracks)。 */
  items: MediaItem[];
  /** 可下载的歌曲清单(歌单/专辑已展开)。 */
  songs: MediaItem[];
}

/** 网易云音乐客户端。 */
export class NeteaseMusicClient {
  readonly #session: WeapiSession;
  readonly #songs: SongApi;
  readonly #playlists: PlaylistApi;
  readonly #lyrics: LyricApi;
  readonly #user: UserApi;
  readonly #downloader: SongDownloader;
  readonly #authPath: string | undefined;
  readonly #concurrency: number;
  #credentials: NeteaseCredentials | null;

  constructor(options: NeteaseClientOptions = {}) {
    this.#authPath = options.authPath;

    // 登录态:cookie 显式优先,否则从 AuthStore 加载。
    // authPath 缺省时也用默认平台路径(与 CLI login 保存位置一致)。
    let cookie = options.cookie;
    if (cookie === undefined) {
      const store =
        options.authPath !== undefined
          ? new AuthStore({ platform: "netease-music", path: options.authPath })
          : new AuthStore({ platform: "netease-music" });
      const stored = store.loadSync();
      cookie = typeof stored?.credentials?.cookies === "string" ? stored.credentials.cookies : undefined;
    }
    this.#credentials = cookie !== undefined
      ? { cookies: cookie }
      : null;

    this.#session = new WeapiSession({
      ...(cookie !== undefined ? { cookie } : {}),
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    });
    this.#songs = new SongApi(this.#session);
    this.#playlists = new PlaylistApi(this.#session);
    this.#lyrics = new LyricApi(this.#session);
    this.#user = new UserApi(this.#session);
    this.#downloader = new SongDownloader(
      this.#songs,
      this.#lyrics,
      options.download ?? {},
      USER_AGENT,
    );
    this.#concurrency = options.download?.concurrency ?? 1;
  }

  /** 当前是否已登录(有 MUSIC_U cookie)。 */
  get isLoggedIn(): boolean {
    return this.#session.cookieValue("MUSIC_U") !== undefined;
  }

  /** 登录态存储路径(未配置 authPath 时为 undefined)。 */
  get authPath(): string | undefined {
    return this.#authPath;
  }

  /** 网易云二维码登录适配器(供 account qrcodeLogin 使用)。 */
  static qrAdapter(options?: { baseUrl?: string }): ReturnType<typeof neteaseQrAdapter> {
    return neteaseQrAdapter(options);
  }

  /**
   * 解析网易云链接:歌曲返回单曲;歌单/专辑展开为歌曲清单。
   */
  async parse(input: string): Promise<ParsedMedia> {
    const parsed = parseNeteaseUrl(input);
    const items = await this.#fetchItems(parsed.type, parsed.id);
    const songs = flattenSongs(items);
    return { items, songs };
  }

  /** 解析并返回原始 MediaItem 列表(与 bilibili parse 风格一致)。 */
  async parseItems(input: string): Promise<MediaItem[]> {
    return (await this.parse(input)).items;
  }

  /** 获取歌曲信息。 */
  async getSongInfo(id: string | number): Promise<SongInfo> {
    return this.#playlists.getSongInfo(String(id));
  }

  /** 获取账号 VIP 信息。 */
  async getVipInfo(): Promise<VipInfo> {
    return this.#songs.getVipInfo();
  }

  /** 获取当前登录账号信息(uid/nickname)。 */
  async getAccountInfo(): Promise<AccountInfo> {
    return this.#user.getAccountInfo();
  }

  /** 获取用户歌单列表(含"我喜欢的音乐" specialType=5 与订阅歌单)。 */
  async getUserPlaylists(options?: {
    uid?: string;
    limit?: number;
    offset?: number;
  }): Promise<UserPlaylistSummary[]> {
    return this.#user.getUserPlaylists(options);
  }

  /** 获取红心(喜欢)歌曲 id 列表。 */
  async getLikeList(options?: { uid?: string }): Promise<string[]> {
    return this.#user.getLikeList(options);
  }

  /** 批量检查歌曲是否已红心。 */
  async checkLiked(trackIds: Array<string | number>): Promise<Map<string, boolean>> {
    return this.#user.checkLiked(trackIds);
  }

  /** 红心收藏一首歌。 */
  async likeSong(trackId: string | number): Promise<void> {
    await this.#user.likeSong(trackId);
  }

  /** 取消红心收藏一首歌。 */
  async unlikeSong(trackId: string | number): Promise<void> {
    await this.#user.unlikeSong(trackId);
  }

  /** 向歌单添加歌曲。 */
  async addTracksToPlaylist(
    playlistId: string | number,
    trackIds: Array<string | number>,
  ): Promise<void> {
    await this.#user.addTracksToPlaylist(playlistId, trackIds);
  }

  /** 从歌单移除歌曲。 */
  async removeTracksFromPlaylist(
    playlistId: string | number,
    trackIds: Array<string | number>,
  ): Promise<void> {
    await this.#user.removeTracksFromPlaylist(playlistId, trackIds);
  }

  /** 收藏(订阅)歌单。 */
  async subscribePlaylist(playlistId: string | number): Promise<void> {
    await this.#user.subscribePlaylist(playlistId);
  }

  /** 取消收藏(退订)歌单。 */
  async unsubscribePlaylist(playlistId: string | number): Promise<void> {
    await this.#user.unsubscribePlaylist(playlistId);
  }

  /** 创建歌单,返回新歌单 id。 */
  async createPlaylist(options: { name: string; privacy?: number; type?: string }): Promise<string> {
    return this.#user.createPlaylist(options);
  }

  /** 删除歌单。 */
  async deletePlaylist(playlistId: string | number): Promise<void> {
    await this.#user.deletePlaylist(playlistId);
  }

  /** 获取单曲可用品质清单(按账号身份过滤)。 */
  async getAvailableLevels(id: string | number): Promise<QualityLevel[]> {
    const privilege = await this.#songs.getPrivilege(String(id));
    return privilege.availableLevels;
  }

  /** 下载一首歌(权限预检 + 试听拦截强制)。 */
  async download(item: MediaItem, options?: DownloadSongOptions): Promise<DownloadResult> {
    if (item.type !== "song") {
      // 歌单/专辑:展开后逐首下载(并发受配置限制)。
      const songs = flattenSongs([item]);
      if (songs.length === 0) {
        throw new NeteaseError("NOT_FOUND", "no songs in this playlist/album");
      }
      const results = await downloadWithConcurrency(
        songs,
        this.#concurrency,
        (song) => this.download(song, options),
      );
      const first = results[0];
      if (first === undefined) {
        throw new NeteaseError("UNKNOWN", "download produced no result");
      }
      return first;
    }
    return this.#downloader.download(item, {
      ...(options?.outputDir !== undefined ? { outputDir: options.outputDir } : {}),
      ...(options?.level !== undefined ? { level: options.level } : {}),
      ...(options?.lyric !== undefined ? { lyric: options.lyric } : {}),
      ...(options?.lyricMode !== undefined ? { lyricMode: options.lyricMode } : {}),
      ...(options?.cover !== undefined ? { cover: options.cover } : {}),
      ...(options?.writeTags !== undefined ? { writeTags: options.writeTags } : {}),
      ...(options?.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    });
  }

  /** 便捷:按链接或歌曲 ID 下载。 */
  async downloadByInput(
    input: string,
    options?: DownloadSongOptions,
  ): Promise<DownloadResult> {
    const parsed = isNeteaseUrl(input)
      ? parseNeteaseUrl(input)
      : { type: "song" as MediaType, id: input };
    const items = await this.#fetchItems(parsed.type, parsed.id);
    const songs = flattenSongs(items);
    if (songs.length === 0) {
      throw new NeteaseError("NOT_FOUND", `no songs found for: ${input}`);
    }
    const results = await downloadWithConcurrency(
      songs,
      this.#concurrency,
      (song) => this.download(song, options),
    );
    const first = results[0];
    if (first === undefined) {
      throw new NeteaseError("UNKNOWN", "download produced no result");
    }
    return first;
  }

  async #fetchItems(type: MediaType, id: string): Promise<MediaItem[]> {
    switch (type) {
      case "song":
        return [await this.#toSongItem(id)];
      case "playlist":
        return this.#playlists.getPlaylist(id);
      case "album":
        return this.#playlists.getAlbum(id);
    }
  }

  async #toSongItem(id: string): Promise<MediaItem> {
    const info = await this.#playlists.getSongInfo(id);
    return {
      type: "song",
      id: info.id,
      title: info.title,
      artists: info.artists,
      album: info.album,
      ...(info.coverUrl !== undefined ? { coverUrl: info.coverUrl } : {}),
      ...(info.durationMs > 0 ? { durationMs: info.durationMs } : {}),
    };
  }
}

/** 把歌单/专辑展开为歌曲清单;已是歌曲则原样返回。 */
function flattenSongs(items: MediaItem[]): MediaItem[] {
  const result: MediaItem[] = [];
  for (const item of items) {
    if (item.type === "song") {
      result.push(item);
    } else if (item.tracks !== undefined && item.tracks.length > 0) {
      result.push(...item.tracks);
    }
  }
  return result;
}

/** 并发受限地执行批量任务,保持输入顺序返回结果;任一失败即中止。 */
async function downloadWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<DownloadResult>,
): Promise<DownloadResult[]> {
  const limit = Math.max(1, concurrency);
  const results: DownloadResult[] = new Array(items.length);
  let next = 0;
  const workers: Array<Promise<void>> = [];
  const runWorker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      if (index >= items.length) {
        return;
      }
      next += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      const result = await task(item);
      results[index] = result;
    }
  };
  for (let i = 0; i < Math.min(limit, items.length); i += 1) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
  return results;
}

/** 创建客户端。 */
export function createNeteaseClient(options?: NeteaseClientOptions): NeteaseMusicClient {
  return new NeteaseMusicClient(options);
}

export type { NeteaseCredentials };
