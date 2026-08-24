/**
 * @sakurachiyo0v0/booth 公共出口。
 * 只导出稳定 API;内部实现细节不导出。
 */
export { BoothError, toBoothError, checkApiResponse, isBoothError, isBoothErrorCode, isFreeItem } from "./errors.js";
export type { BoothErrorCode } from "./errors.js";
export {
  BoothSession,
  parseCookieString,
  cookieStringify,
  collectSetCookies,
} from "./session.js";
export type { BoothCredentials } from "./session.js";
export { ItemApi, parseItemPage, parseItemDetail, extractCsrfToken, extractPriceYen, extractSeller, extractTitle, extractJsonLd, extractDownloadUrl, extractVariationId, extractDescription, extractVariations } from "./api/item.js";
export { ClaimApi, extractRedirectLocation, toClaimResult } from "./api/order.js";
export type { ClaimActionResult } from "./api/order.js";
export { DownloadApi, sanitizeFilename, fileNameFromUrl, fileNameFromDisposition } from "./api/download.js";
export type { DownloadUrlOptions } from "./api/download.js";
export { parseBoothInput, isBoothUrl, normalizeItemId, extractItemIdFromUrl } from "./parsers/url.js";
export type { ParsedBoothInput } from "./parsers/url.js";
export { BoothClient, createBoothClient, loginBooth } from "./client.js";
// 浏览器工具函数已上移到 account 骨架,此处 re-export 保持公共 API 不变。
export { detectBrowser, defaultBrowserProfileDir, openBrowserDefault } from "@sakurachiyo0v0/account";
export { boothBrowserAdapter, BOOTH_COOKIE_DOMAINS, BOOTH_SESSION_COOKIE_NAMES } from "./login-adapter.js";
export type {
  BoothClientOptions,
  BoothItem,
  BoothItemDetail,
  BoothLoginOptions,
  BoothVariation,
  ClaimAndDownloadResult,
  ClaimConfig,
  ClaimResult,
  ClaimStatus,
  DownloadConfig,
  DownloadProgress,
  ItemDetailOptions,
} from "./types.js";
