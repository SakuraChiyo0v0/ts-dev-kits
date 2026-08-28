/** 规则执行模式:XPath 抓 HTML 页面,或 API 请求模板抓 JSON。 */
export type RuleMode = "xpath" | "api";

/** API 请求体类型。 */
export type ApiBodyType = "none" | "json" | "form";

/** 章节 API 响应格式:nested 嵌套 JSON 或 delimited 分隔串。 */
export type ApiChapterFormat = "nested" | "delimited";

/** API 请求模板(兼容 Kazumi ApiRequestConfig)。 */
export interface ApiRequestConfig {
  method: "GET" | "POST";
  /** 请求 URL 模板,支持 {keyword} / {source} 变量。 */
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  bodyType?: ApiBodyType;
  body?: unknown;
}

/** API 模式搜索配置(兼容 Kazumi ApiSearchConfig)。 */
export interface ApiSearchConfig {
  request: ApiRequestConfig;
  /** 结果列表 JSONPath。 */
  listPath: string;
  /** 标题 JSONPath(相对列表项)。 */
  namePath: string;
  /** 详情页 URL JSONPath(相对列表项)。 */
  sourcePath: string;
}

/** API 模式章节配置(兼容 Kazumi ApiChapterConfig)。 */
export interface ApiChapterConfig {
  request: ApiRequestConfig;
  format?: ApiChapterFormat;
  // nested 模式
  /** 线路列表 JSONPath。 */
  roadsPath?: string;
  roadNamePath?: string;
  /** 集数列表 JSONPath(相对线路项)。 */
  episodesPath?: string;
  episodeNamePath?: string;
  /** 播放页 URL JSONPath(相对集数项)。 */
  episodeUrlPath?: string;
  // delimited 模式
  roadNamesPath?: string;
  roadEpisodesPath?: string;
  roadSeparator?: string;
  episodeSeparator?: string;
  fieldSeparator?: string;
}

/** 反爬配置(仅声明站点需要的检测/头信息,不含验证码破解)。 */
export interface AntiCrawlerConfig {
  enabled?: boolean;
  /** 验证码检测文本(页面包含即判定需要验证码)。 */
  captchaDetectValue?: string;
}

/** 番剧站点规则(Kazumi 规则 JSON 兼容,字段语义以本文件为权威)。 */
export interface AnimeRule {
  /** 规则 API 级别(兼容 Kazumi,如 "1")。 */
  api: string;
  /** 站点类型,默认 "anime"。 */
  type: string;
  /** 规则名(文件名 = 规则名,去重主键)。 */
  name: string;
  version: string;
  /** 是否多线路。 */
  muliSources: boolean;
  userAgent: string;
  /** 站点根 URL。 */
  baseUrl: string;
  /** 搜索 URL,含 @keyword 占位符(XPath 模式)。 */
  searchURL: string;
  referer: string;
  // XPath 模式字段
  searchMode: RuleMode;
  /** 搜索结果列表节点(绝对 XPath)。 */
  searchList: string;
  /** 标题 XPath(相对列表项)。 */
  searchName: string;
  /** 详情页 URL XPath(相对列表项)。 */
  searchResult: string;
  chapterMode: RuleMode;
  /** 线路列表 XPath(绝对)。 */
  chapterRoads: string;
  /** 集数 XPath(相对线路节点)。 */
  chapterResult: string;
  // API 模式字段
  searchApiConfig?: ApiSearchConfig;
  chapterApiConfig?: ApiChapterConfig;
  // 反爬
  antiCrawlerConfig?: AntiCrawlerConfig;
}

/** 搜索结果(标题 + 详情页 URL)。 */
export interface SearchItem {
  name: string;
  src: string;
}

/** 线路(线路名 + 集数页 URL 列表)。 */
export interface Road {
  name: string;
  /** 集数页 URL 列表。 */
  data: string[];
  /** 集数名列表(与 data 对齐)。 */
  identifier: string[];
}

/** 集数(名称 + 播放页 URL)。 */
export interface Episode {
  name: string;
  url: string;
}

/** 规则执行追踪(调试/测试用)。 */
export interface RuleTrace {
  rawResponse: string;
  matchedFragments: string[];
  diagnostics: string[];
}

/** 下载进度快照。 */
export interface DownloadProgress {
  episodeName: string;
  /** 已下载字节数。 */
  downloadedBytes: number;
  /** 总字节数(未知时为 null)。 */
  totalBytes: number | null;
  /** 下载速度 bytes/s。 */
  speed: number;
}

/** 下载配置。 */
export interface DownloadOptions {
  /** 分片下载并发数,默认 4。 */
  concurrency?: number;
  /** 分片重试次数,默认 3。 */
  retries?: number;
  /** 单请求超时毫秒,默认 30_000。 */
  timeoutMs?: number;
  /** 是否启用 discontinuity 分组广告过滤,默认 true。 */
  adFilter?: boolean;
}

/** 客户端配置。 */
export interface AnimeClientOptions {
  /** 规则目录,默认 <配置根>/amechan/kazumi/rules/。 */
  rulesDir?: string;
  /** 可注入请求实现(测试用)。 */
  fetchImpl?: typeof fetch;
  /** 是否开启 WebDAV 规则同步(经 config 包 namespace('kazumi'),默认 false)。 */
  sync?: boolean;
  download?: DownloadOptions;
}
