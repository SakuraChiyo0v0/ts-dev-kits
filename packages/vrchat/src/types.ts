/**
 * VRChat API 数据模型。字段语义以 VRChat 官方 OpenAPI 为权威
 * (https://vrchatapi.github.io/)。raw JSON 保持原样透传,类型只做描述不做强制清洗。
 */
import type { ConfigNamespace } from "@sakurachiyo0v0/config";

// ---- 认证 ----

/** 2FA 验证方式。 */
export type TwoFactorAuthMethod = "emailOtp" | "totp";

/** 当前登录用户(登录/会话检查返回)。 */
export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  /** 当前使用头像的 id。 */
  avatarId: string;
  /** 在线状态:active | join me | ask me | busy | offline。 */
  state: string;
  /** 自定义状态文本。 */
  statusDescription: string;
  /** 好友申请状态:active | join me | ask me | busy | offline。 */
  status: string;
  bio: string;
  bioLinks: string[];
  /** 账号启用 2FA 时,登录响应会带此字段,值为 ["emailOtp","totp"] 的子集。 */
  requiresTwoFactorAuth?: TwoFactorAuthMethod[];
  /** 信任等级:visitor | new user | user | known user | trusted user。 */
  developerType: string;
  /** 是否为 VRChat Team 成员。 */
  isVrcTeam: boolean;
  currentAvatarImageUrl: string;
  currentAvatarThumbnailImageUrl: string;
  /** 会话失效时间。 */
  expiresAt: string;
  friendKey: string;
  lastLogin: string;
  lastPlatform: string;
  /** 注册日期。 */
  date_joined: string;
  /** 好友数。 */
  friendCount: number;
  /** 在线好友数。 */
  onlineFriends: number;
  /** 是否允许头像克隆。 */
  allowAvatarCopying: boolean;
  /** 账号标签,如 ["system_trust_basic"]。 */
  tags: string[];
  [key: string]: unknown;
}

/** 全局配置(GET /config)。 */
/** 全局配置(GET /config 原始响应;字段随版本变化,除常见项外以索引签名透传)。 */
export interface ApiConfig {
  appName?: string;
  releaseVersion?: string;
  messageOfTheDay?: string;
  /** 客户端启动配置等。 */
  [key: string]: unknown;
}

// ---- 用户 ----

/** 用户基本信息(搜索结果 / 好友列表等)。 */
export interface LimitedUser {
  id: string;
  username: string;
  displayName: string;
  avatarId: string;
  bio?: string;
  state?: string;
  status?: string;
  statusDescription?: string;
  friendKey: string;
  lastLogin?: string;
  isFriend?: boolean;
  tags?: string[];
  [key: string]: unknown;
}

/** 用户好友关系状态。 */
export interface FriendStatus {
  isFriend: boolean;
  /** 我是否发出了好友申请(等待对方接受)。 */
  outgoingRequest: boolean;
  /** 对方是否向我发出了好友申请。 */
  incomingRequest: boolean;
}

// ---- 世界 ----

/** 世界信息。 */
export interface World {
  id: string;
  name: string;
  description: string;
  authorId: string;
  authorName: string;
  /** 最大同时在线人数。 */
  capacity: number;
  imageUrl: string;
  thumbnailImageUrl: string;
  /** 总访问人数。 */
  visits: number;
  /** 总收藏数。 */
  favorites: number;
  /** 总好评数。 */
  heat: number;
  popularity: number;
  /** 发布时间。 */
  publicationDate?: string;
  /** 最近更新时间。 */
  updatedAt?: string;
  /** 是否已发布(草稿为 false)。 */
  publicationStatus?: string;
  tags: string[];
  [key: string]: unknown;
}

// ---- 头像 ----

/** 头像信息。 */
export interface Avatar {
  id: string;
  name: string;
  description: string;
  authorId: string;
  authorName: string;
  imageUrl: string;
  thumbnailImageUrl: string;
  /** 资源下载 URL(受登录态保护)。 */
  assetUrl?: string;
  /** 资产格式版本。 */
  assetVersion?: number;
  /** 平台支持:"standalonewindows" | "android" 等。 */
  platform?: string;
  /** 发布时间。 */
  created_at?: string;
  /** 最近更新时间。 */
  updated_at?: string;
  /** 是否已发布。 */
  releaseStatus?: string;
  tags: string[];
  [key: string]: unknown;
}

// ---- 实例 ----

/** 实例类型。 */
export type InstanceType = "public" | "hidden" | "friends" | "private" | "group";

/** 实例信息。 */
export interface Instance {
  id: string;
  /** 世界 id。 */
  worldId: string;
  /** 实例类型。 */
  type: InstanceType;
  /** 当前实例内人数。 */
  occupants: number;
  /** 实例最大人数。 */
  capacity: number;
  /** 实例名(显示名)。 */
  name?: string;
  /** 短码(实例 id 的可读形式)。 */
  shortName?: string;
  /** 创建者用户 id。 */
  ownerId?: string;
  [key: string]: unknown;
}

// ---- 好友 ----

/** 好友列表项(即 LimitedUser 的扩展)。 */
export interface Friend extends LimitedUser {
  isFriend: true;
  /** 当前所在实例位置(如 wrld_xxx:12345~region(jp));offline / private 表示离线。新版 API 无 presence 字段,用此判断在线。 */
  location?: string;
  /** 当前所在世界 id。 */
  worldId?: string;
}

// ---- 通知 ----

/** 通知类型。 */
export type NotificationType =
  | "friendRequest"
  | "invite"
  | "requestInvite"
  | "message"
  | "groupInvite"
  | "groupRequestInvite"
  | "votetokick"
  | "other";

/** 通知。 */
export interface Notification {
  id: string;
  /** 通知类型。 */
  type: NotificationType;
  /** 发送者用户 id。 */
  senderUserId: string;
  /** 接收者用户 id。 */
  receiverUserId: string;
  /** 通知文本(JSON 字符串,含详情)。 */
  message: string;
  /** 创建时间。 */
  created_at: string;
  /** 是否已查看。 */
  seen?: boolean;
  /** 关联的详情数据(消息内容等)。 */
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

// ---- 收藏 ----

/** 收藏类型。 */
export type FavoriteType = "world" | "avatar" | "friend";

/** 收藏项。 */
export interface Favorite {
  id: string;
  /** 收藏类型。 */
  type: FavoriteType;
  /** 收藏的目标 id(世界 id / 头像 id / 用户 id)。 */
  favoriteId: string;
  /** 收藏标签,如 ["avatars_1"]。 */
  tags: string[];
  [key: string]: unknown;
}

// ---- 群组 ----

/** 群组信息。 */
export interface Group {
  id: string;
  name: string;
  shortCode: string;
  description: string;
  ownerId: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

// ---- 文件 ----

/** 文件上传信息。 */
export interface FileUpload {
  id: string;
  name: string;
  ownerId: string;
  mimeType: string;
  sizeInBytes?: number;
  created_at: string;
  [key: string]: unknown;
}

// ---- 权限 ----

/** 账号权限位。 */
export interface Permission {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  [key: string]: unknown;
}

// ---- 客户端配置 ----

/** 客户端创建选项。 */
export interface VrchatClientOptions {
  /** AuthStore 自定义路径(缺省用平台默认 <配置根>/amechan/vrchat/auth.json)。 */
  authPath?: string;
  /**
   * 可选远程登录态命名空间(配置中心加密域,如 config().namespace("auth",{encrypt:true}))。
   * 登录态双写本地+远程;新机还原:先 await new AuthStore({platform:"vrchat",remote}).load()。
   */
  remote?: ConfigNamespace;
  /** 显式会话 cookie 字符串(优先于 AuthStore 加载)。 */
  cookie?: string;
  /** 覆盖 API 基地址(测试用 mock)。 */
  baseUrl?: string;
  /** 注入 fetch 实现(测试用)。 */
  fetchImpl?: typeof fetch;
  /** 请求超时(毫秒),默认 15000。 */
  timeoutMs?: number;
  /** 429 自动退避重试的最大次数,默认 2。 */
  maxRetries?: number;
  /** 自定义 User-Agent。 */
  userAgent?: string;
}
