export { createAnimeClient, defaultRulesDir, resolveConfigRoot } from "./client.js";
export type { AnimeClient, RuleManager } from "./client.js";
export { RuleEngine } from "./engine/engine.js";
export type { ChapterTrace, SearchTrace } from "./engine/engine.js";
export { RestrictedJsonPath } from "./engine/restricted-jsonpath.js";
export { RuleLoader, ruleFromJson, validateRule } from "./rules/loader.js";
export { RuleSync } from "./rules/sync.js";
export { normalizeEpisodeUrl } from "./engine/xpath-strategy.js";
export { parseM3u8, extractUniqueKeys, buildLocalM3u8 } from "./stream/m3u8.js";
export { filterAds, calculateTargetDuration } from "./stream/ad-filter.js";
export { PlaybackResolver, extractM3u8Url, extractIframeUrl } from "./stream/resolver.js";
export type { ResolvedSource } from "./stream/resolver.js";
export { KazumiError, toKazumiError } from "./errors.js";
export type { KazumiErrorCode } from "./errors.js";
export type {
  AnimeClientOptions,
  AnimeRule,
  AntiCrawlerConfig,
  ApiBodyType,
  ApiChapterConfig,
  ApiChapterFormat,
  ApiRequestConfig,
  ApiSearchConfig,
  DownloadOptions,
  DownloadProgress,
  Episode,
  Road,
  RuleMode,
  RuleTrace,
  SearchItem,
} from "./types.js";
