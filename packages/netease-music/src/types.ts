/** 网易云音乐 SDK 核心类型。 */
import type { ConfigNamespace } from "@sakurachiyo0v0/config";

/** 音乐品质等级(对应取流接口 level 参数)。 */
export type QualityLevel = "standard" | "higher" | "exhigh" | "lossless" | "hires";

/** 品质 → 位率/说明。 */
export const QUALITY_BITRATE: Record<QualityLevel, number> = {
  standard: 128_000,
  higher: 192_000,
  exhigh: 320_000,
  lossless: 0, // FLAC 无损
  hires: 0, // Hi-Res
};

/** 媒体项类型。 */
export type MediaType = "song" | "playlist" | "album";

/** 解析后的媒体项。 */
export interface MediaItem {
  type: MediaType;
  /** 歌曲 ID(数字字符串);歌单/专辑展开后为其中歌曲。 */
  id: string;
  title: string;
  /** 歌手(逗号分隔或数组)。 */
  artists?: string[];
  album?: string;
  /** 封面图 URL。 */
  coverUrl?: string;
  /** 时长(毫秒)。 */
  durationMs?: number;
  /** 歌单/专辑的歌曲清单(展开后)。 */
  tracks?: MediaItem[];
}

/** 歌曲信息。 */
export interface SongInfo {
  id: string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number;
  coverUrl?: string;
  /** 歌曲状态(0 正常);来自 song detail 原始字段。 */
  st?: number;
  /** 收费标记(0 免费 / 1 VIP 单曲 / 8 VIP 专辑);来自 song detail 原始字段。 */
  fee?: number;
}

/** 歌词信息。 */
export interface LyricInfo {
  /** 原文歌词(LRC 格式)。 */
  original?: string;
  /** 翻译歌词(LRC 格式)。 */
  translated?: string;
}

/** 推荐歌单（每日推荐歌单）。 */
export interface RecommendPlaylist {
  id: string;
  name: string;
  coverUrl?: string;
  playCount: number;
}

/** 单曲权限(基于 song detail 的 fee/st + 账号 VIP 状态,不依赖已废弃的 privilege 接口)。 */
export interface SongPrivilege {
  id: string;
  /** 可下载品质(按账号身份过滤后的完整品质清单)。 */
  availableLevels: QualityLevel[];
  /** 是否可试听(服务端裁决;SDK 将试听视为拒绝)。 */
  canPlay: boolean;
  /** 是否 VIP 专属。 */
  isVipSong: boolean;
  /** 原始 fee/st 字段(调试用)。 */
  raw: Record<string, unknown>;
}

/** 账号 VIP 信息(vip/info 接口)。 */
export interface VipInfo {
  /** 是否 VIP。 */
  isVip: boolean;
  /** VIP 等级(1-7,非 VIP 为 0)。 */
  level: number;
  /** VIP 类型(music/musician 等)。 */
  vipType: number;
}

/** 取流结果。 */
export interface StreamInfo {
  url: string;
  /** 实际品质(服务端返回;可能与请求不同)。 */
  level: QualityLevel;
  /** 文件大小(字节,可选)。 */
  size?: number;
  /** 时长(毫秒,可选)。 */
  durationMs?: number;
  /** 是否为试听片段(服务端标记;SDK 拒绝)。 */
  isTrial: boolean;
}

/** 下载进度。 */
export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
  speed: number;
  /** 当前歌曲(批量时)。 */
  itemTitle?: string;
}

/** 下载结果。 */
export interface DownloadResult {
  /** 音频文件路径。 */
  filePath: string;
  /** 实际品质。 */
  level: QualityLevel;
  /** 歌词文件路径(可选)。 */
  lyricPath?: string;
  /** 封面文件路径(可选)。 */
  coverPath?: string;
}

/** 下载配置。 */
export interface DownloadConfig {
  /** 并发数(批量下载时),默认 1。 */
  concurrency?: number;
  /** 失败重试次数,默认 3。 */
  retries?: number;
  /** 默认输出目录。 */
  outputDir?: string;
}

/** 客户端选项。 */
export interface NeteaseClientOptions {
  /** 显式 cookie 字符串(优先于 authPath 存储)。 */
  cookie?: string;
  /** 未传 cookie 时,从该 AuthStore 加载登录态。 */
  authPath?: string;
  /**
   * 可选远程登录态命名空间(配置中心加密域,如 config().namespace("auth",{encrypt:true}))。
   * 登录态双写本地+远程;新机还原:先 await new AuthStore({ platform: "netease-music", remote }).load()。
   */
  remote?: ConfigNamespace;
  /** 下载配置。 */
  download?: DownloadConfig;
  /** 注入 fetch(测试用)。 */
  fetchImpl?: typeof fetch;
  /** 覆盖 API base URL(测试用)。 */
  baseUrl?: string;
}
