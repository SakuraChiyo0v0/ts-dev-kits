/**
 * VrchatClient 门面 —— 统一入口。创建时自动从 AuthStore 加载登录态(或显式 cookie),
 * 领域能力以 client.auth / users / worlds / ... 提供(按阶段逐个接入)。
 */
import { AuthStore, passwordLogin, type PasswordLoginOptions, type LoginResult } from "@sakurachiyo0v0/account";
import { VrchatHttpTransport } from "./transport.js";
import { VrchatError } from "./errors.js";
import { VrchatPasswordAdapter } from "./auth-adapter.js";
import { AuthApi } from "./endpoints/auth.js";
import { UsersApi } from "./endpoints/users.js";
import { WorldsApi } from "./endpoints/worlds.js";
import { AvatarsApi } from "./endpoints/avatars.js";
import { InstancesApi } from "./endpoints/instances.js";
import { FriendsApi } from "./endpoints/friends.js";
import { NotificationsApi } from "./endpoints/notifications.js";
import { FavoritesApi } from "./endpoints/favorites.js";
import { GroupsApi } from "./endpoints/groups.js";
import { FilesApi } from "./endpoints/files.js";
import { PermissionsApi } from "./endpoints/permissions.js";
import { SystemApi } from "./endpoints/system.js";
import { EconomyApi } from "./endpoints/economy.js";
import { ModerationApi } from "./endpoints/moderation.js";
import { InviteApi } from "./endpoints/invite.js";
import { MessagesApi } from "./endpoints/messages.js";
import type { VrchatClientOptions } from "./types.js";

export interface VrchatClient {
  /** 当前是否持有会话 cookie。 */
  readonly isLoggedIn: boolean;
  readonly auth: AuthApi;
  readonly users: UsersApi;
  readonly worlds: WorldsApi;
  readonly avatars: AvatarsApi;
  readonly instances: InstancesApi;
  readonly friends: FriendsApi;
  readonly notifications: NotificationsApi;
  readonly favorites: FavoritesApi;
  readonly groups: GroupsApi;
  readonly files: FilesApi;
  readonly permissions: PermissionsApi;
  readonly system: SystemApi;
  readonly economy: EconomyApi;
  readonly moderation: ModerationApi;
  readonly invite: InviteApi;
  readonly messages: MessagesApi;
  /** 登录(密码 + 可选 2FA);成功后可持久化到 AuthStore。 */
  login(options: Omit<PasswordLoginOptions, "adapter">): Promise<LoginResult>;
  /** 登出:调用 API 并清除本地 cookie 与存储。 */
  logout(): Promise<void>;
  /** 关闭传输层。 */
  close(): Promise<void>;
}

/** 创建客户端。优先使用显式 cookie,否则从 AuthStore 加载。 */
export async function createVrchatClient(
  options: VrchatClientOptions = {},
): Promise<VrchatClient> {
  const transport = new VrchatHttpTransport({
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.cookie !== undefined ? { cookie: options.cookie } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
  });

  const adapter = new VrchatPasswordAdapter({ transport });

  // 未显式传 cookie 时从 AuthStore 加载。
  if (options.cookie === undefined) {
    const store = new AuthStore({
      platform: "vrchat",
      ...(options.authPath !== undefined ? { path: options.authPath } : {}),
      ...(options.remote !== undefined ? { remote: options.remote } : {}),
    });
    const payload = store.loadSync();
    if (payload !== null) {
      const credentials = adapter.deserialize(payload);
      if (credentials !== null && typeof credentials.authCookie === "string") {
        transport.setCookie(credentials.authCookie);
      }
    }
  }

  const auth = new AuthApi(transport);
  const users = new UsersApi(transport);
  const worlds = new WorldsApi(transport);
  const avatars = new AvatarsApi(transport);
  const instances = new InstancesApi(transport);
  const friends = new FriendsApi(transport);
  const notifications = new NotificationsApi(transport);
  const favorites = new FavoritesApi(transport);
  const groups = new GroupsApi(transport);
  const files = new FilesApi(transport);
  const permissions = new PermissionsApi(transport);
  const system = new SystemApi(transport);
  const economy = new EconomyApi(transport);
  const moderation = new ModerationApi(transport);
  const invite = new InviteApi(transport);
  const messages = new MessagesApi(transport);

  const client: VrchatClient = {
    get isLoggedIn() {
      return transport.cookie !== undefined;
    },
    auth,
    users,
    worlds,
    avatars,
    instances,
    friends,
    notifications,
    favorites,
    groups,
    files,
    permissions,
    system,
    economy,
    moderation,
    invite,
    messages,
    async login(loginOptions) {
      const result = await passwordLogin({ ...loginOptions, adapter });
      return result;
    },
    async logout() {
      if (transport.cookie !== undefined) {
        try {
          await auth.logout();
        } catch (error) {
          if (error instanceof VrchatError && error.code !== "AUTH_EXPIRED") {
            throw error;
          }
          // 会话已失效也继续清理本地
        }
      }
      const store = new AuthStore({
        platform: "vrchat",
        ...(options.authPath !== undefined ? { path: options.authPath } : {}),
        ...(options.remote !== undefined ? { remote: options.remote } : {}),
      });
      await store.clear();
    },
    async close() {
      await transport.close();
    },
  };

  return client;
}
