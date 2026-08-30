/** Bilibili SDK 核心类型。 */

/** 内容类型。第一版先实现 video,其余类型为第二版预留。 */
export type ContentType =
  | "video"        // 投稿视频(BV)
  | "bangumi"      // 番剧
  | "cheese"       // 课程
  | "audio"        // B站音乐
  | "space"        // UP主空间
  | "favlist"      // 收藏夹
  | "collection"   // 合集
  | "popular"      // 每周必看
  | "watch_later"  // 稍后再看
  | "history"      // 历史记录
  | "dynamic";     // 动态

/** 单个分P。 */
export interface VideoPage {
  cid: number;
  page: number;
  part: string;
  duration: number;
}

/** 解析后的媒体项(统一模型)。 */
export interface MediaItem {
  type: ContentType;
  /** 唯一标识,如 bvid / ep_id / sid。 */
  id: string;
  /** 视频 aid。 */
  aid?: number;
  /** 视频 bvid。 */
  bvid?: string;
  /** 分P cid。 */
  cid?: number;
  /** 番剧 ep_id。 */
  epId?: number;
  /** 番剧/课程 season_id。 */
  seasonId?: number;
  /** 音频 sid。 */
  sid?: number;
  /** 分P 列表(多P视频)。 */
  pages?: VideoPage[];
  /** 标题。 */
  title: string;
  /** 封面 URL。 */
  cover?: string;
  /** 时长(秒)。 */
  duration?: number;
  /** 播放量。 */
  play?: number;
  /** 评论数。 */
  comment?: number;
  /** 发布时间(unix 秒)。 */
  pubdate?: number;
  /** 分区 id。 */
  tid?: number;
  /** 简介。 */
  description?: string;
  /** 是否充电专属视频。 */
  chargingArc?: boolean;
  /** UP主信息。 */
  owner?: { mid: number; name: string };
  /** 原始解析数据。 */
  raw: unknown;
}

/** 播放流中的一个媒体流(视频或音频)。 */
export interface MediaStream {
  /** 清晰度 id(视频)或音质 id(音频)。 */
  id: number;
  /** 编码 id(视频):AVC=7, HEVC=12, AV1=13。 */
  codecId?: number;
  /** 可用下载 URL 列表(按优先级)。 */
  urls: string[];
  /** 码率。 */
  bandwidth?: number;
  /** 帧率。 */
  frameRate?: string;
  /** 音频参数。 */
  audio?: { id?: number; bandwidth?: number; name?: string };
  /** 原始数据。 */
  raw: unknown;
}

/** 播放流结果。 */
export interface PlayStream {
  /** 实际可用的最高清晰度。 */
  quality: number;
  /** 视频流列表(不同清晰度/编码)。 */
  videoStreams: MediaStream[];
  /** 音频流列表。 */
  audioStreams: MediaStream[];
  /** 视频时长(毫秒)。 */
  timelength?: number;
  /** 是否 DASH 格式(音视频分离)。 */
  dash: boolean;
}

/** 清晰度枚举(常用)。 */
export enum Quality {
  Q8K = 127,
  DolbyVision = 126,
  HDR = 125,
  Q4K = 120,
  Q1080P60 = 116,
  Q1080PPlus = 112,
  Q1080P = 80,
  Q720P = 64,
  Q480P = 32,
  Q360P = 16,
}

/** 视频编码枚举。 */
export enum VideoCodec {
  AVC = 7,
  HEVC = 12,
  AV1 = 13,
}

/** 列表类解析选项(空间/收藏夹等分页列表)。 */
export interface ListParseOptions {
  /** 页码,从 1 开始,默认 1。 */
  pn?: number;
  /** 每页数量,默认 40,最大 50。 */
  ps?: number;
  /** 排序:pubdate(发布时间,默认) | click(播放量) | favorite(收藏数)。 */
  order?: string;
  /** 分区 tid 过滤,0=全部。 */
  tid?: number;
}

/** 解析器接口:每种内容类型实现一次。 */
export interface Parser {
  readonly type: ContentType;
  /** 解析 URL,返回媒体项列表。 */
  parse(url: string, options?: ListParseOptions): Promise<MediaItem[]>;
}

/** 播放流获取接口(按媒体项取流)。 */
export interface StreamResolver {
  /** 获取播放流。 */
  getStreams(item: MediaItem, options?: StreamOptions): Promise<PlayStream>;
}

/** 取流选项。 */
export interface StreamOptions {
  /** 目标清晰度;取不到时自动降级到最高可用。 */
  quality?: number;
  /** 目标视频编码;不指定时按优先级自动选。 */
  codec?: VideoCodec;
}

/** 下载器配置。 */
export interface DownloadConfig {
  /** 并发下载数,1=单线程。 */
  concurrency?: number;
  /** 分块大小(字节),默认 4MB。 */
  chunkSize?: number;
  /** 失败重试次数,默认 5。 */
  retries?: number;
  /** 限速(MB/s),0 不限速。 */
  speedLimitMbps?: number;
  /** 断点续传(文件已存在则跳过已下载部分),默认 true。 */
  resume?: boolean;
  /** 过滤 pcdn/mcdn 劣质 CDN 链接,默认 true。 */
  filterPcdn?: boolean;
  /** 单个请求超时(秒),默认 10。 */
  timeoutSeconds?: number;
}

/** 下载进度回调。 */
export interface DownloadProgress {
  /** 已下载字节。 */
  downloaded: number;
  /** 总字节。 */
  total: number;
  /** 百分比 0-100。 */
  percent: number;
  /** 当前速度(bytes/s)。 */
  speed: number;
  /** 当前阶段:video / audio / merging。 */
  stage: "video" | "audio" | "merging";
}

/** 客户端配置。 */
export interface BilibiliClientOptions {
  /** 登录 Cookie(可选,高画质需要)。如 "SESSDATA=...; bili_jct=..."。 */
  cookie?: string;
  /** 登录态存储路径;未显式传 cookie 时自动从该存储加载(默认平台用户配置目录)。 */
  authPath?: string;
  /**
   * 可选远程登录态命名空间(配置中心加密域,如 config().namespace("auth",{encrypt:true}))。
   * 登录态双写本地+远程;新机还原:先 await new AuthStore({platform:"bilibili",remote}).load()。
   */
  remote?: import("@sakurachiyo0v0/config").ConfigNamespace;
  /** 自定义 User-Agent。 */
  userAgent?: string;
  /** API 根地址(测试用,默认官方)。 */
  baseUrl?: string;
  /** 动态等 vc 域接口根地址(测试用,默认官方 api.vc.bilibili.com)。 */
  vcBaseUrl?: string;
  /** 创作中心接口根地址(测试用,默认官方 member.bilibili.com)。 */
  memberBaseUrl?: string;
  /** 下载器配置。 */
  download?: DownloadConfig;
  /** 是否合并音视频(需 @sakurachiyo0v0/ffmpeg),默认 true。 */
  merge?: boolean;
}
