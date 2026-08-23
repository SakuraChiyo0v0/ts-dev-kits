/**
 * 本地 mock VRChat API 服务器 —— 用 Node 原生 http 实现真实协议路径测试。
 *
 * 覆盖端点:
 * - GET  /auth/user            登录(Basic Auth,URL 编码凭证);按凭据返回 401 或 200(可带 requiresTwoFactorAuth)
 * - POST /auth/twofactorauth/{emailotp|totp}/verify  按 code 返回 200(verified + cookie)或 401
 * - GET  /auth                 会话检查("ok":"true")
 * - GET  /auth/user            当前用户(需 cookie)
 * - PUT  /logout               登出
 * - GET  /config               全局配置
 * - 429 模拟:特定路径/次数返回 429 + Retry-After
 * - GET  /users/{id}           用户详情
 * - GET  /users                用户搜索
 * - GET  /users/{id}/friendStatus   好友状态
 * - GET  /worlds/{id}          世界详情
 * - GET  /worlds               世界搜索
 * - GET  /avatars/{id}         头像详情
 * - GET  /avatars              头像搜索
 * - GET  /instances/{worldId}:{instanceId}  实例详情
 * - GET  /auth/user/friends    好友列表
 * - GET  /auth/user/notifications  通知列表
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockVrchatServerOptions {
  /** 用户名密码(默认 alice / pw123)。 */
  username?: string;
  password?: string;
  /** 是否要求 2FA(默认 false)。 */
  requireTwoFactor?: boolean;
  /** 2FA 正确验证码(默认 "123456")。 */
  twoFactorCode?: string;
  /** 使 429 模拟:前 n 次对 /config 返回 429。 */
  rateLimitConfigTimes?: number;
}

const CURRENT_USER = {
  id: "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  username: "alice",
  displayName: "Alice",
  avatarId: "avtr_00000000-0000-0000-0000-000000000000",
  state: "active",
  statusDescription: "",
  status: "active",
  bio: "mock user",
  bioLinks: [],
  developerType: "user",
  isVrcTeam: false,
  currentAvatarImageUrl: "https://example.com/avatar.png",
  currentAvatarThumbnailImageUrl: "https://example.com/avatar_thumb.png",
  expiresAt: "2099-01-01T00:00:00.000Z",
  friendKey: "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee_alice",
  lastLogin: "2026-01-01T00:00:00.000Z",
  lastPlatform: "standalonewindows",
  date_joined: "2020-01-01T00:00:00.000Z",
  friendCount: 0,
  onlineFriends: 0,
  allowAvatarCopying: false,
  tags: ["system_trust_basic"],
};

const CONFIG = {
  appName: "VRChat",
  releaseVersion: "2026.1.1",
  downloadLink: "https://vrchat.com/download",
  messageOfTheDay: "mock",
};

const MOCK_USER = {
  id: "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
  username: "bob",
  displayName: "Bob",
  avatarId: "avtr_00000000-0000-0000-0000-000000000001",
  state: "offline",
  statusDescription: "",
  status: "offline",
  bio: "mock user 2",
  friendKey: "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee_bob",
  lastLogin: "2026-01-02T00:00:00.000Z",
  tags: ["system_trust_basic"],
};

const MOCK_WORLD = {
  id: "wrld_00000000-0000-0000-0000-000000000000",
  name: "Mock World",
  description: "a mock world",
  authorId: "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  authorName: "Alice",
  capacity: 16,
  imageUrl: "https://example.com/world.png",
  thumbnailImageUrl: "https://example.com/world_thumb.png",
  visits: 100,
  favorites: 10,
  heat: 5,
  popularity: 1,
  publicationStatus: "public",
  tags: ["system_approved"],
};

const MOCK_AVATAR = {
  id: "avtr_00000000-0000-0000-0000-000000000001",
  name: "Mock Avatar",
  description: "a mock avatar",
  authorId: "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  authorName: "Alice",
  imageUrl: "https://example.com/avatar2.png",
  thumbnailImageUrl: "https://example.com/avatar2_thumb.png",
  assetUrl: "https://example.com/avatar2.vrc",
  assetVersion: 1,
  platform: "standalonewindows",
  releaseStatus: "public",
  tags: ["system_approved"],
};

const MOCK_INSTANCE = {
  id: "12345~private(usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)~region(us)~nonce(abc)",
  worldId: "wrld_00000000-0000-0000-0000-000000000000",
  type: "private",
  occupants: 1,
  capacity: 16,
  name: "Mock Instance",
  shortName: "mock",
  ownerId: "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
};

const MOCK_FRIENDS = [MOCK_USER];

const MOCK_NOTIFICATIONS = [
  {
    id: "ntf_00000000-0000-0000-0000-000000000000",
    type: "friendRequest",
    senderUserId: "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
    receiverUserId: "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    message: '{"message":"friend request"}',
    created_at: "2026-01-01T00:00:00.000Z",
    seen: false,
    details: { message: "friend request" },
  },
];

const MOCK_FAVORITE = {
  id: "fvrt_00000000-0000-0000-0000-000000000000",
  type: "avatar",
  favoriteId: "avtr_00000000-0000-0000-0000-000000000001",
  tags: ["avatars_1"],
};

const MOCK_FAVORITE_GROUP = {
  id: "fvrtgrp_00000000-0000-0000-0000-000000000000",
  ownerId: "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  type: "avatar",
  name: "avatars_1",
  displayName: "My Avatars",
  visible: false,
  tags: ["avatars_1"],
};

const MOCK_GROUP = {
  id: "grp_00000000-0000-0000-0000-000000000000",
  name: "Mock Group",
  shortCode: "MOCK",
  description: "a mock group",
  ownerId: "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  memberCount: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const MOCK_GROUP_ROLE = {
  id: "grp_00000000-0000-0000-0000-000000000000_member",
  name: "Member",
  description: "Default role",
  isSelfAssignable: true,
  permissions: [],
};

const MOCK_FILE = {
  id: "file_00000000-0000-0000-0000-000000000000",
  name: "mock.png",
  ownerId: "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  mimeType: "image/png",
  sizeInBytes: 1024,
  created_at: "2026-01-01T00:00:00.000Z",
};

const MOCK_PERMISSION = {
  id: "permission_00000000-0000-0000-0000-000000000000",
  name: "avatar-access",
  displayName: "Avatar Access",
  description: "Can upload avatars",
};

export class MockVrchatServer {
  readonly #server: Server;
  readonly #options: Required<MockVrchatServerOptions>;
  #port = 0;
  #config429Count = 0;

  constructor(options: MockVrchatServerOptions = {}) {
    this.#options = {
      username: options.username ?? "alice",
      password: options.password ?? "pw123",
      requireTwoFactor: options.requireTwoFactor ?? false,
      twoFactorCode: options.twoFactorCode ?? "123456",
      rateLimitConfigTimes: options.rateLimitConfigTimes ?? 0,
    };
    this.#server = createServer((req, res) => {
      void this.#handle(req, res);
    });
  }

  /** 启动并返回 baseUrl。 */
  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.#server.listen(0, "127.0.0.1", resolve));
    const address = this.#server.address() as AddressInfo;
    this.#port = address.port;
    return this.baseUrl;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.#port}`;
  }

  get port(): number {
    return this.#port;
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections?.();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  async #handle(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", this.baseUrl);
    const path = url.pathname;
    const method = req.method ?? "GET";

    // 429 模拟:/config 前 N 次
    if (path === "/config" && method === "GET") {
      if (this.#config429Count < this.#options.rateLimitConfigTimes) {
        this.#config429Count += 1;
        res.writeHead(429, { "retry-after": "0" });
        res.end(JSON.stringify({ error: { message: "rate limited", status_code: 429 } }));
        return;
      }
      this.#json(res, 200, CONFIG);
      return;
    }

    // 登录 = GET /auth/user + Basic(凭证 URL 编码后 base64;真实 API 拒绝 POST,返回 405)
    if (path === "/auth/user" && method === "GET" && (req.headers.authorization ?? "").startsWith("Basic ")) {
      const auth = req.headers.authorization ?? "";
      const encoded = `${encodeURIComponent(this.#options.username)}:${encodeURIComponent(this.#options.password)}`;
      const expected = `Basic ${Buffer.from(encoded).toString("base64")}`;
      if (auth !== expected) {
        this.#json(res, 401, { error: { message: "Invalid username or password.", status_code: 401 } });
        return;
      }
      if (this.#options.requireTwoFactor) {
        // 2FA 中间会话:第一步即 Set-Cookie 会话 cookie(真实 API:auth=authcookie_<uuid>),
        // verify 必须携带;最终会话 cookie 仍是这个(verify 响应只发 twoFactorAuth 票据)。
        res.setHeader("Set-Cookie", "auth=authcookie_mock_interim; Path=/; HttpOnly; SameSite=Lax");
        this.#json(res, 200, { ...CURRENT_USER, requiresTwoFactorAuth: ["emailOtp", "totp"] });
        return;
      }
      this.#setAuthCookie(res);
      this.#json(res, 200, CURRENT_USER);
      return;
    }

    const twoFactorMatch = path.match(/^\/auth\/twofactorauth\/(emailotp|totp)\/verify$/);
    if (twoFactorMatch !== null && method === "POST") {
      // 必须携带第一步的中间会话 cookie,否则 401(回归保护:2FA 中间 cookie 链路)
      if (!this.#hasAuthCookie(req)) {
        this.#json(res, 401, { error: { message: "Missing interim session.", status_code: 401 } });
        return;
      }
      const body = await this.#readBody(req);
      const code = (JSON.parse(body) as { code?: string }).code ?? "";
      if (code === this.#options.twoFactorCode) {
        // 真实 API:verify 成功只 Set-Cookie twoFactorAuth 票据,会话 cookie 仍是第一步的 auth
        res.setHeader("Set-Cookie", "twoFactorAuth=mock-jwt-ticket; Max-Age=2592000; Path=/; HttpOnly");
        this.#json(res, 200, { verified: true });
        return;
      }
      this.#json(res, 401, { error: { message: "Invalid 2FA code.", status_code: 401 } });
      return;
    }

    if (path === "/auth" && method === "GET") {
      if (this.#hasAuthCookie(req)) {
        this.#json(res, 200, { ok: "true" });
      } else {
        this.#json(res, 401, { error: { message: "Not logged in.", status_code: 401 } });
      }
      return;
    }

    if (path === "/auth/user" && method === "GET") {
      if (this.#hasAuthCookie(req)) {
        this.#json(res, 200, CURRENT_USER);
      } else {
        this.#json(res, 401, { error: { message: "Not logged in.", status_code: 401 } });
      }
      return;
    }

    if (path === "/logout" && method === "PUT") {
      this.#json(res, 200, { success: { message: "Logged out." } });
      return;
    }

    // ---- 系统(无需登录部分)----
    if (path === "/visits" && method === "GET") {
      this.#json(res, 200, 100);
      return;
    }
    if (path === "/time" && method === "GET") {
      this.#json(res, 200, "2026-08-23T12:00:00+00:00");
      return;
    }
    // 头像风格(真实 API 无需登录)
    if (path === "/avatarStyles" && method === "GET") {
      this.#json(res, 200, [{ id: "style1", name: "Stylized" }]);
      return;
    }

    // ---- 六域查询(需登录) ----
    if (!this.#hasAuthCookie(req)) {
      this.#json(res, 401, { error: { message: "Not logged in.", status_code: 401 } });
      return;
    }
    // 健康检查(真实 API 需登录)
    if (path === "/health" && method === "GET") {
      this.#json(res, 200, { ok: true });
      return;
    }

    // 用户
    // 注意:特殊路径(active/groups/avatar/name)必须在 /users/{id} 之前匹配。
    if (path === "/users/active" && method === "GET") {
      this.#json(res, 200, [CURRENT_USER, MOCK_USER]);
      return;
    }
    const profileMatch = path.match(/^\/profile\/([^/]+)$/);
    if (profileMatch !== null && method === "GET") {
      this.#json(res, 200, MOCK_USER);
      return;
    }
    const userMatch = path.match(/^\/users\/([^/]+)$/);
    if (userMatch !== null && method === "GET") {
      if (userMatch[1] === "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") {
        this.#json(res, 200, CURRENT_USER);
      } else if (userMatch[1] === "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee") {
        this.#json(res, 200, MOCK_USER);
      } else {
        this.#json(res, 404, { error: { message: "User not found.", status_code: 404 } });
      }
      return;
    }
    if (path === "/users" && method === "GET") {
      const search = url.searchParams.get("search");
      const users = search !== null && search !== "" && !MOCK_USER.username.includes(search)
        ? []
        : [CURRENT_USER, MOCK_USER];
      this.#json(res, 200, users);
      return;
    }
    const friendStatusMatch = path.match(/^\/user\/([^/]+)\/friendStatus$/);
    if (friendStatusMatch !== null && method === "GET") {
      this.#json(res, 200, {
        isFriend: friendStatusMatch[1] === "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
        outgoingRequest: false,
        incomingRequest: false,
      });
      return;
    }

    // 世界
    // 注意:特殊路径(favorites/recent/active)必须在 /worlds/{id} 之前匹配。
    if (path === "/worlds/favorites" && method === "GET") {
      this.#json(res, 200, [MOCK_WORLD]);
      return;
    }
    if (path === "/worlds/recent" && method === "GET") {
      this.#json(res, 200, [MOCK_WORLD]);
      return;
    }
    if (path === "/worlds/active" && method === "GET") {
      this.#json(res, 200, [MOCK_WORLD]);
      return;
    }
    const worldMatch = path.match(/^\/worlds\/([^/]+)$/);
    if (worldMatch !== null && method === "GET") {
      this.#json(res, 200, MOCK_WORLD);
      return;
    }
    const worldInstancesMatch = path.match(/^\/worlds\/([^/]+)\/instances$/);
    if (worldInstancesMatch !== null && method === "GET") {
      this.#json(res, 200, [MOCK_INSTANCE]);
      return;
    }
    const worldMetadataMatch = path.match(/^\/worlds\/([^/]+)\/metadata$/);
    if (worldMetadataMatch !== null && method === "GET") {
      this.#json(res, 200, MOCK_WORLD);
      return;
    }
    const worldTagsMatch = path.match(/^\/worlds\/([^/]+)\/(addTags|removeTags)$/);
    if (worldTagsMatch !== null && method === "PUT") {
      this.#json(res, 200, MOCK_WORLD);
      return;
    }
    if (path === "/worlds" && method === "GET") {
      this.#json(res, 200, [MOCK_WORLD]);
      return;
    }
    if (path === "/worlds" && method === "POST") {
      this.#json(res, 200, MOCK_WORLD);
      return;
    }

    // 头像
    // 注意:/avatars/favorites、/avatars/licensed、/avatarStyles 必须在 /avatars/{id} 之前匹配。
    if (path === "/avatars/favorites" && method === "GET") {
      this.#json(res, 200, [MOCK_AVATAR]);
      return;
    }
    if (path === "/avatars/licensed" && method === "GET") {
      this.#json(res, 200, [MOCK_AVATAR]);
      return;
    }
    const avatarMatch = path.match(/^\/avatars\/([^/]+)$/);
    if (avatarMatch !== null && method === "GET") {
      this.#json(res, 200, MOCK_AVATAR);
      return;
    }
    if (path === "/avatars" && method === "GET") {
      // 真实 API:文本搜索必须带 marketplace(paid|free|all),否则 400
      const url = new URL(req.url ?? "", "http://mock.local");
      const search = url.searchParams.get("search");
      if (search !== null && !["paid", "free", "all"].includes(url.searchParams.get("marketplace") ?? "")) {
        this.#json(res, 400, {
          error: { message: "Text search queries must specify a marketplace", status_code: 400 },
        });
        return;
      }
      this.#json(res, 200, [MOCK_AVATAR]);
      return;
    }

    // 实例
    if (path === "/instances/recent" && method === "GET") {
      this.#json(res, 200, [MOCK_INSTANCE]);
      return;
    }
    const instanceShortNameMatch = path.match(/^\/instances\/([^/]+):([^/]+)\/shortName$/);
    if (instanceShortNameMatch !== null && method === "GET") {
      this.#json(res, 200, {
        shortName: "8WR5X",
        location: `${instanceShortNameMatch[1]}:${instanceShortNameMatch[2]}`,
      });
      return;
    }
    const instanceMatch = path.match(/^\/instances\/(.+)$/);
    if (instanceMatch !== null && method === "GET") {
      this.#json(res, 200, MOCK_INSTANCE);
      return;
    }
    if (path === "/instances" && method === "POST") {
      this.#json(res, 200, MOCK_INSTANCE);
      return;
    }

    // 邀请
    const inviteMatch = path.match(/^\/invite\/([^/]+)$/);
    if (inviteMatch !== null && method === "POST") {
      this.#json(res, 200, MOCK_NOTIFICATIONS[0]);
      return;
    }
    const requestInviteMatch = path.match(/^\/requestInvite\/([^/]+)$/);
    if (requestInviteMatch !== null && method === "POST") {
      this.#json(res, 200, MOCK_NOTIFICATIONS[0]);
      return;
    }
    const inviteSelfMatch = path.match(/^\/invite\/myself\/to\/(.+)$/);
    if (inviteSelfMatch !== null && method === "POST") {
      this.#json(res, 200, MOCK_NOTIFICATIONS[0]);
      return;
    }
    const notifyRespondMatch = path.match(/^\/notifications\/([^/]+)\/respond$/);
    if (notifyRespondMatch !== null && method === "PUT") {
      this.#json(res, 200, MOCK_NOTIFICATIONS[0]);
      return;
    }
    // 快捷消息
    const msgListMatch = path.match(/^\/message\/([^/]+)\/([^/]+)$/);
    if (msgListMatch !== null && method === "GET") {
      this.#json(res, 200, [{ slug: "message_1", type: msgListMatch[2], message: "Hello!", updatedAt: "2026-01-01T00:00:00.000Z", canBeUpdated: true }]);
      return;
    }
    const msgSlotMatch = path.match(/^\/message\/([^/]+)\/([^/]+)\/(\d+)$/);
    if (msgSlotMatch !== null && method === "GET") {
      this.#json(res, 200, { slug: `message_${msgSlotMatch[3]}`, type: msgSlotMatch[2], message: "Hello!", updatedAt: "2026-01-01T00:00:00.000Z", canBeUpdated: true });
      return;
    }
    if (msgSlotMatch !== null && method === "PUT") {
      const body = await this.#readBody(req);
      const data = JSON.parse(body) as { message?: string };
      this.#json(res, 200, { slug: `message_${msgSlotMatch[3]}`, type: msgSlotMatch[2], message: data.message ?? "", updatedAt: "2026-01-01T00:00:00.000Z", canBeUpdated: true });
      return;
    }

    // 好友
    if (path === "/auth/user/friends" && method === "GET") {
      this.#json(res, 200, MOCK_FRIENDS);
      return;
    }
    const friendRequestMatch = path.match(/^\/user\/([^/]+)\/friendRequest$/);
    if (friendRequestMatch !== null && method === "POST") {
      this.#json(res, 200, { success: { message: "Friend request sent." } });
      return;
    }
    const deleteFriendMatch = path.match(/^\/auth\/user\/friends\/([^/]+)$/);
    if (deleteFriendMatch !== null && method === "DELETE") {
      this.#json(res, 200, { success: { message: "Friend deleted." } });
      return;
    }

    // 通知
    if (path === "/auth/user/notifications" && method === "GET") {
      this.#json(res, 200, MOCK_NOTIFICATIONS);
      return;
    }
    const notifByIdMatch = path.match(/^\/notifications\/([^/]+)$/);
    if (notifByIdMatch !== null && method === "GET") {
      this.#json(res, 200, MOCK_NOTIFICATIONS[0]);
      return;
    }
    const notifReplyMatch = path.match(/^\/notifications\/([^/]+)\/reply$/);
    if (notifReplyMatch !== null && method === "POST") {
      this.#json(res, 200, MOCK_NOTIFICATIONS[0]);
      return;
    }
    if (path === "/auth/user/favoritelimits" && method === "GET") {
      this.#json(res, 200, { avatar: 100, friend: 100, world: 100 });
      return;
    }
    const acceptNotifMatch = path.match(/^\/auth\/user\/notifications\/([^/]+)\/accept$/);
    if (acceptNotifMatch !== null && method === "PUT") {
      this.#json(res, 200, { ...MOCK_NOTIFICATIONS[0]!, seen: true });
      return;
    }
    const hideNotifMatch = path.match(/^\/auth\/user\/notifications\/([^/]+)\/hide$/);
    if (hideNotifMatch !== null && method === "PUT") {
      this.#json(res, 200, { ...MOCK_NOTIFICATIONS[0]!, seen: true });
      return;
    }
    const seeNotifMatch = path.match(/^\/auth\/user\/notifications\/([^/]+)\/see$/);
    if (seeNotifMatch !== null && method === "PUT") {
      this.#json(res, 200, { ...MOCK_NOTIFICATIONS[0]!, seen: true });
      return;
    }
    if (path === "/auth/user/notifications/clear" && method === "PUT") {
      this.#json(res, 200, { success: { message: "Notifications cleared." } });
      return;
    }

    // 收藏
    if (path === "/favorites" && method === "GET") {
      this.#json(res, 200, [MOCK_FAVORITE]);
      return;
    }
    if (path === "/favorites" && method === "POST") {
      this.#json(res, 200, MOCK_FAVORITE);
      return;
    }
    const favoriteMatch = path.match(/^\/favorites\/([^/]+)$/);
    if (favoriteMatch !== null && method === "DELETE") {
      this.#json(res, 200, { success: { message: "Favorite removed." } });
      return;
    }
    if (path === "/favorite/groups" && method === "GET") {
      this.#json(res, 200, [MOCK_FAVORITE_GROUP]);
      return;
    }
    if (path === "/favorite/groups" && method === "POST") {
      this.#json(res, 200, MOCK_FAVORITE_GROUP);
      return;
    }
    const favoriteByGroupMatch = path.match(/^\/favorite\/group\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (favoriteByGroupMatch !== null && method === "GET") {
      this.#json(res, 200, [MOCK_FAVORITE]);
      return;
    }
    const favoriteGroupMatch = path.match(/^\/favorite\/groups\/([^/]+)$/);
    if (favoriteGroupMatch !== null && method === "DELETE") {
      this.#json(res, 200, { success: { message: "Favorite group deleted." } });
      return;
    }

    // 头像选择
    const selectAvatarMatch = path.match(/^\/avatars\/([^/]+)\/select$/);
    if (selectAvatarMatch !== null && method === "PUT") {
      this.#json(res, 200, { ...CURRENT_USER, avatarId: selectAvatarMatch[1] });
      return;
    }
    const selectFallbackMatch = path.match(/^\/avatars\/([^/]+)\/selectFallback$/);
    if (selectFallbackMatch !== null && method === "PUT") {
      this.#json(res, 200, { ...CURRENT_USER, avatarId: selectFallbackMatch[1] });
      return;
    }

    // 用户更新(PUT /users/{userId})
    const userUpdateMatch = path.match(/^\/users\/([^/]+)$/);
    if (userUpdateMatch !== null && method === "PUT") {
      const body = await this.#readBody(req);
      const updates = JSON.parse(body) as Record<string, unknown>;
      this.#json(res, 200, { ...CURRENT_USER, ...updates });
      return;
    }

    // 用户群组 / 当前头像 / 活跃用户
    const userGroupsMatch = path.match(/^\/users\/([^/]+)\/groups$/);
    if (userGroupsMatch !== null && method === "GET") {
      this.#json(res, 200, [MOCK_GROUP]);
      return;
    }
    const userAvatarMatch = path.match(/^\/users\/([^/]+)\/avatar$/);
    if (userAvatarMatch !== null && method === "GET") {
      this.#json(res, 200, MOCK_AVATAR);
      return;
    }
    // 共同好友
    const userMutualsMatch = path.match(/^\/users\/([^/]+)\/mutuals$/);
    if (userMutualsMatch !== null && method === "GET") {
      this.#json(res, 200, [MOCK_USER]);
      return;
    }

    // 用户备注
    if (path === "/userNotes" && method === "GET") {
      this.#json(res, 200, [{ id: "unote_00000000-0000-0000-0000-000000000000", targetUserId: "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", note: "hello", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }]);
      return;
    }
    if (path === "/userNotes" && method === "POST") {
      const body = await this.#readBody(req);
      const data = JSON.parse(body) as { targetUserId?: string; note?: string };
      this.#json(res, 200, { id: "unote_00000000-0000-0000-0000-000000000001", targetUserId: data.targetUserId ?? "", note: data.note ?? "", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
      return;
    }
    const userNoteMatch = path.match(/^\/userNotes\/([^/]+)$/);
    if (userNoteMatch !== null && method === "PUT") {
      const body = await this.#readBody(req);
      const data = JSON.parse(body) as { note?: string };
      this.#json(res, 200, { id: userNoteMatch[1], targetUserId: "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", note: data.note ?? "", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
      return;
    }
    if (userNoteMatch !== null && method === "DELETE") {
      this.#json(res, 200, { success: { message: "Note deleted." } });
      return;
    }

    // ---- P3 进阶域(需登录) ----

    // 群组
    if (path === "/groups/roleTemplates" && method === "GET") {
      this.#json(res, 200, [{ id: "grole_template1", name: "Member", description: "默认成员", permissions: ["group-members"] }]);
      return;
    }
    const groupMatch = path.match(/^\/groups\/([^/]+)$/);
    if (groupMatch !== null && method === "GET") {
      this.#json(res, 200, MOCK_GROUP);
      return;
    }
    if (path === "/groups" && method === "GET") {
      this.#json(res, 200, [MOCK_GROUP]);
      return;
    }
    if (path === "/groups" && method === "POST") {
      this.#json(res, 200, MOCK_GROUP);
      return;
    }
    const groupUpdateMatch = path.match(/^\/groups\/([^/]+)$/);
    if (groupUpdateMatch !== null && method === "PUT") {
      const body = await this.#readBody(req);
      const updates = JSON.parse(body) as Record<string, unknown>;
      this.#json(res, 200, { ...MOCK_GROUP, ...updates });
      return;
    }
    if (groupMatch !== null && method === "DELETE") {
      this.#json(res, 200, { success: { message: "Group deleted." } });
      return;
    }
    const groupMembersMatch = path.match(/^\/groups\/([^/]+)\/members$/);
    if (groupMembersMatch !== null && method === "GET") {
      this.#json(res, 200, [{ ...MOCK_USER, roleIds: [], isRepresenting: false, joinedAt: "2026-01-01T00:00:00.000Z" }]);
      return;
    }
    // 单个成员 / 成员角色分配(需在 members 列表之后)
    const groupMemberByIdMatch = path.match(/^\/groups\/([^/]+)\/members\/([^/]+)$/);
    if (groupMemberByIdMatch !== null && method === "GET") {
      this.#json(res, 200, { ...MOCK_USER, roleIds: [], isRepresenting: false, joinedAt: "2026-01-01T00:00:00.000Z" });
      return;
    }
    if (groupMemberByIdMatch !== null && method === "DELETE") {
      this.#json(res, 200, { success: { message: "Member removed." } });
      return;
    }
    const groupMemberRoleMatch = path.match(/^\/groups\/([^/]+)\/members\/([^/]+)\/roles\/([^/]+)$/);
    if (groupMemberRoleMatch !== null && (method === "PUT" || method === "DELETE")) {
      this.#json(res, 200, { ...MOCK_USER, roleIds: [groupMemberRoleMatch[3]], isRepresenting: false, joinedAt: "2026-01-01T00:00:00.000Z" });
      return;
    }
    // 申请
    const groupRequestsMatch = path.match(/^\/groups\/([^/]+)\/requests$/);
    if (groupRequestsMatch !== null && method === "GET") {
      this.#json(res, 200, [{ ...MOCK_USER, roleIds: [], isRepresenting: false, joinedAt: "2026-01-01T00:00:00.000Z" }]);
      return;
    }
    const groupInstancesMatch = path.match(/^\/groups\/([^/]+)\/instances$/);
    if (groupInstancesMatch !== null && method === "GET") {
      this.#json(res, 200, [MOCK_INSTANCE]);
      return;
    }
    const groupPermissionsMatch = path.match(/^\/groups\/([^/]+)\/permissions$/);
    if (groupPermissionsMatch !== null && method === "GET") {
      this.#json(res, 200, ["group-members"]);
      return;
    }
    const groupRequestApproveMatch = path.match(/^\/groups\/([^/]+)\/requests\/([^/]+)$/);
    if (groupRequestApproveMatch !== null && method === "POST") {
      this.#json(res, 200, { ...MOCK_USER, roleIds: [], isRepresenting: false, joinedAt: "2026-01-01T00:00:00.000Z" });
      return;
    }
    // 封禁
    const groupBansMatch = path.match(/^\/groups\/([^/]+)\/bans$/);
    if (groupBansMatch !== null && method === "GET") {
      this.#json(res, 200, [{ user: MOCK_USER, bannedAt: "2026-01-01T00:00:00.000Z" }]);
      return;
    }
    if (groupBansMatch !== null && method === "POST") {
      this.#json(res, 200, { user: MOCK_USER, bannedAt: "2026-01-01T00:00:00.000Z" });
      return;
    }
    const groupUnbanMatch = path.match(/^\/groups\/([^/]+)\/bans\/([^/]+)$/);
    if (groupUnbanMatch !== null && method === "DELETE") {
      this.#json(res, 200, { success: { message: "User unbanned." } });
      return;
    }
    const groupRolesMatch = path.match(/^\/groups\/([^/]+)\/roles$/);
    if (groupRolesMatch !== null && method === "GET") {
      this.#json(res, 200, [MOCK_GROUP_ROLE]);
      return;
    }
    if (groupRolesMatch !== null && method === "POST") {
      this.#json(res, 200, MOCK_GROUP_ROLE);
      return;
    }
    const groupRoleDeleteMatch = path.match(/^\/groups\/([^/]+)\/roles\/([^/]+)$/);
    if (groupRoleDeleteMatch !== null && method === "DELETE") {
      this.#json(res, 200, { success: { message: "Role deleted." } });
      return;
    }
    const groupJoinMatch = path.match(/^\/groups\/([^/]+)\/join$/);
    if (groupJoinMatch !== null && method === "PUT") {
      this.#json(res, 200, MOCK_GROUP);
      return;
    }
    const groupLeaveMatch = path.match(/^\/groups\/([^/]+)\/leave$/);
    if (groupLeaveMatch !== null && method === "PUT") {
      this.#json(res, 200, { success: { message: "Left group." } });
      return;
    }
    const groupAnnouncementMatch = path.match(/^\/groups\/([^/]+)\/announcement$/);
    if (groupAnnouncementMatch !== null && method === "GET") {
      this.#json(res, 200, { groupId: groupAnnouncementMatch[1], message: "Hello", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
      return;
    }
    if (groupAnnouncementMatch !== null && method === "POST") {
      const body = await this.#readBody(req);
      const { message } = JSON.parse(body) as { message?: string };
      this.#json(res, 200, { groupId: groupAnnouncementMatch[1], message: message ?? "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
      return;
    }

    // 文件
    const fileMatch = path.match(/^\/file\/([^/]+)$/);
    if (fileMatch !== null && method === "GET") {
      this.#json(res, 200, MOCK_FILE);
      return;
    }
    if (path === "/files" && method === "GET") {
      this.#json(res, 200, [MOCK_FILE]);
      return;
    }
    if (path === "/file/image" && method === "POST") {
      const body = await this.#readBody(req);
      const data = JSON.parse(body) as Record<string, unknown>;
      this.#json(res, 200, { ...MOCK_FILE, name: data.name, mimeType: data.mimeType });
      return;
    }
    if (path === "/file" && method === "POST") {
      const body = await this.#readBody(req);
      const data = JSON.parse(body) as Record<string, unknown>;
      this.#json(res, 200, { ...MOCK_FILE, name: data.name, mimeType: data.mimeType });
      return;
    }
    if (fileMatch !== null && method === "DELETE") {
      this.#json(res, 200, { success: { message: "File deleted." } });
      return;
    }
    // 文件上传链路:/file/{fileId}/{versionId}/{fileType}/{start|finish|status}
    const fileUploadMatch = path.match(/^\/file\/([^/]+)\/(\d+)\/([^/]+)\/(start|finish|status)$/);
    if (fileUploadMatch !== null && method === "PUT") {
      const action = fileUploadMatch[4];
      if (action === "start") {
        this.#json(res, 200, { url: "https://example.com/upload-target", uploadId: "mock-upload" });
      } else if (action === "finish") {
        this.#json(res, 200, { etags: ["mock-etag"], version: { id: Number(fileUploadMatch[2]), status: "complete" } });
      } else {
        this.#json(res, 200, { id: Number(fileUploadMatch[2]), status: "complete" });
      }
      return;
    }

    // 世界管理
    const worldPublishMatch = path.match(/^\/worlds\/([^/]+)\/publish$/);
    if (worldPublishMatch !== null && method === "PUT") {
      this.#json(res, 200, MOCK_WORLD);
      return;
    }
    if (worldMatch !== null && method === "PUT") {
      const body = await this.#readBody(req);
      const updates = JSON.parse(body) as Record<string, unknown>;
      this.#json(res, 200, { ...MOCK_WORLD, ...updates });
      return;
    }
    if (worldMatch !== null && method === "DELETE") {
      this.#json(res, 200, { success: { message: "World deleted." } });
      return;
    }

    // 权限
    if (path === "/permissions" && method === "GET") {
      this.#json(res, 200, [MOCK_PERMISSION]);
      return;
    }
    const permissionMatch = path.match(/^\/permissions\/([^/]+)$/);
    if (permissionMatch !== null && method === "GET") {
      this.#json(res, 200, MOCK_PERMISSION);
      return;
    }

    // ---- P4 收尾域(需登录) ----

    // 经济
    const balanceMatch = path.match(/^\/user\/([^/]+)\/balance$/);
    if (balanceMatch !== null && method === "GET") {
      this.#json(res, 200, { balance: 42 });
      return;
    }
    const transactionsMatch = path.match(/^\/user\/([^/]+)\/economy\/transactions$/);
    if (transactionsMatch !== null && method === "GET") {
      this.#json(res, 200, [{ id: "txn_00000000-0000-0000-0000-000000000000", status: "succeeded" }]);
      return;
    }

    // 审核
    if (path === "/auth/user/playermoderations" && method === "GET") {
      this.#json(res, 200, [{ id: "pmod_00000000-0000-0000-0000-000000000000", type: "block", targetUserId: "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", created: "2026-01-01T00:00:00.000Z" }]);
      return;
    }
    if (path === "/auth/user/playermoderations" && method === "POST") {
      const body = await this.#readBody(req);
      const data = JSON.parse(body) as Record<string, unknown>;
      this.#json(res, 200, {
        id: "pmod_00000000-0000-0000-0000-000000000000",
        type: data.type,
        targetUserId: data.moderated,
        created: "2026-01-01T00:00:00.000Z",
      });
      return;
    }
    if (path === "/auth/user/unplayermoderate" && method === "PUT") {
      const body = await this.#readBody(req);
      const data = JSON.parse(body) as Record<string, unknown>;
      this.#json(res, 200, {
        id: "pmod_00000000-0000-0000-0000-000000000000",
        type: data.type,
        targetUserId: data.moderated,
        created: "2026-01-01T00:00:00.000Z",
      });
      return;
    }
    if (path === "/moderationReports" && method === "POST") {
      this.#json(res, 200, { success: { message: "Report submitted." } });
      return;
    }

    this.#json(res, 404, { error: { message: "Not found.", status_code: 404 } });
  }

  #setAuthCookie(res: import("node:http").ServerResponse): void {
    res.setHeader("Set-Cookie", "auth=mock-auth-cookie-123; Path=/; HttpOnly");
  }

  #hasAuthCookie(req: import("node:http").IncomingMessage): boolean {
    const cookie = req.headers.cookie ?? "";
    return cookie.includes("auth=");
  }

  #json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  #readBody(req: import("node:http").IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk: Buffer) => {
        data += chunk.toString("utf-8");
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  }
}
