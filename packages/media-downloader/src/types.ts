/** 通用媒体下载 SDK 的公共类型。 */

/** 一次下载的目标：一个可直取的媒体 URL + 落盘信息。 */
export interface DownloadTarget {
  /** 可直接 GET 的媒体地址。 */
  url: string;
  /** 完整文件名（含扩展名，如 `歌手 - 歌名.mp3`）。 */
  filename: string;
  /** 相对 root 的子目录；空或省略表示根目录。 */
  dir?: string;
  /** 可选元数据标签（写入媒体文件）。 */
  tags?: {
    title?: string;
    artist?: string;
    album?: string;
  };
  /** 可选封面图 URL（下载后内嵌进媒体文件）。 */
  coverUrl?: string;
}

/** 下载进度回调。 */
export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

/** 单次下载结果。 */
export interface DownloadResult {
  filePath: string;
}

/** 下载历史记录。 */
export interface DownloadHistoryRecord {
  id: string;
  filename: string;
  filePath: string;
  time: string;
  status: "done" | "error";
}

/** DownloadManager 配置。 */
export interface DownloadManagerConfig {
  /** 下载根目录（所有落盘都发生在其下）。 */
  root: string;
  /** 请求媒体 URL 时使用的 User-Agent，默认一个通用桌面 UA。 */
  userAgent?: string;
  /** 下载失败重试次数，默认 2。 */
  retries?: number;
}
