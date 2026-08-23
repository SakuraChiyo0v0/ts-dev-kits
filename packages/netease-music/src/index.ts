export {
  NeteaseMusicClient,
  createNeteaseClient,
  type DownloadSongOptions,
  type ParsedMedia,
} from "./client.js";
export {
  NeteaseError,
  checkApiResponse,
  toNeteaseError,
  type NeteaseErrorCode,
} from "./errors.js";
export {
  WeapiSession,
  parseCookieString,
  cookieStringify,
  collectSetCookies,
  type NeteaseCredentials,
} from "./api/session.js";
export { SongApi, extractAvailableLevels } from "./api/song.js";
export { PlaylistApi, LyricApi } from "./api/playlist.js";
export {
  UserApi,
  type AccountInfo,
  type UserPlaylistSummary,
} from "./api/user.js";
export {
  SongDownloader,
  assertLevelAllowed,
  assertNotTrial,
  sanitizeFilename,
  DEFAULT_DOWNLOAD_CONFIG,
} from "./download/stream.js";
export { neteaseQrAdapter, extractCoreCookies } from "./auth/adapter.js";
export {
  weapiEncrypt,
  weapiDecrypt,
  eapiEncrypt,
  eapiDecrypt,
  aesDecrypt,
} from "./weapi/encrypt.js";
export { parseNeteaseUrl, isNeteaseUrl, type ParsedNeteaseUrl } from "./parsers/url.js";
export {
  QUALITY_BITRATE,
  type DownloadConfig,
  type DownloadProgress,
  type DownloadResult,
  type LyricInfo,
  type MediaItem,
  type MediaType,
  type NeteaseClientOptions,
  type QualityLevel,
  type SongInfo,
  type SongPrivilege,
  type StreamInfo,
  type VipInfo,
} from "./types.js";
