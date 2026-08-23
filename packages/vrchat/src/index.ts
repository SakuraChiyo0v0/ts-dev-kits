export { createVrchatClient, type VrchatClient } from "./client.js";
export { VrchatError, toVrchatError, type VrchatErrorCode } from "./errors.js";
export { VrchatHttpTransport, type VrchatRequestOptions, type RawResponse } from "./transport.js";
export { VrchatPasswordAdapter, type VrchatPasswordAdapterOptions } from "./auth-adapter.js";
export { AuthApi, type FavoriteLimits } from "./endpoints/auth.js";
export {
  UsersApi,
  type SearchUsersOptions,
  type UpdateUserOptions,
  type UserNote,
  type UserNoteOptions,
  type UserWorldsOptions,
} from "./endpoints/users.js";
export { WorldsApi, type SearchWorldsOptions, type WorldSort } from "./endpoints/worlds.js";
export {
  AvatarsApi,
  type AvatarStyle,
  type SearchAvatarsOptions,
} from "./endpoints/avatars.js";
export { InstancesApi, type CreateInstanceOptions } from "./endpoints/instances.js";
export { FriendsApi, type FriendsOptions } from "./endpoints/friends.js";
export {
  NotificationsApi,
  type NotificationsOptions,
} from "./endpoints/notifications.js";
export {
  FavoritesApi,
  type AddFavoriteOptions,
  type CreateFavoriteGroupOptions,
  type FavoriteGroup,
  type FavoritesOptions,
} from "./endpoints/favorites.js";
export {
  GroupsApi,
  type CreateGroupOptions,
  type GroupAnnouncement,
  type GroupBan,
  type GroupMember,
  type GroupRole,
  type GroupRoleTemplate,
  type SearchGroupsOptions,
} from "./endpoints/groups.js";
export { FilesApi, type CreateFileOptions, type FileVersion, type UploadFileType, type UploadFinishResult, type UploadStartResult } from "./endpoints/files.js";
export { PermissionsApi } from "./endpoints/permissions.js";
export {
  SystemApi,
  type SystemHealth,
  type SystemStats,
  type SystemTime,
} from "./endpoints/system.js";
export { EconomyApi, type Balance, type Transaction } from "./endpoints/economy.js";
export {
  ModerationApi,
  type CreatePlayerModerationOptions,
  type PlayerModeration,
  type PlayerModerationType,
  type ReportOptions,
} from "./endpoints/moderation.js";
export { InviteApi, type InviteOptions } from "./endpoints/invite.js";
export { MessagesApi, type InviteMessage, type InviteMessageType } from "./endpoints/messages.js";
export type {
  ApiConfig,
  Avatar,
  CurrentUser,
  Favorite,
  FavoriteType,
  FileUpload,
  Friend,
  FriendStatus,
  Group,
  Instance,
  InstanceType,
  LimitedUser,
  Notification,
  NotificationType,
  Permission,
  TwoFactorAuthMethod,
  VrchatClientOptions,
  World,
} from "./types.js";
