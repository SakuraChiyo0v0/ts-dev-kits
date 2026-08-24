/**
 * @sakurachiyo0v0/xiaoheihe —— 小黑盒 SDK。
 * P0 只读:扫码登录(复用 account 骨架)+ hkey/nonce 签名 + 帖子/评论/feed/消息/用户查询。
 * 写操作(回复评论)属红线扩展(P1),本版本不提供。
 */
export { createXiaoheiheClient, type XiaoheiheClient, type XiaoheiheClientOptions } from "./client.js";
export { xiaoheiheQrAdapter, buildTokenId, buildCredentials } from "./api/qrcode.js";
export { XiaoheiheError, toXiaoheiheError, type XiaoheiheErrorCode } from "./errors.js";
export { getKeys, getNonce, SIGN_TABLE } from "./sign.js";
export type {
  XiaoheiheCredentials,
  XiaoheiheComment,
  XiaoheiheLink,
  LinkTreeResult,
  SubCommentsResult,
  TextDetail,
  FeedLink,
  XiaoheiheMessage,
  XiaoheiheProfile,
  XiaoheiheResponse,
} from "./types.js";
export { parseLinkText } from "./types.js";
