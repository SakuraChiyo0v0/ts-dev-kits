/**
 * user 域 —— 玩家资料 / vanity 解析 / 封禁信息(ISteamUser)。
 */
import type { SteamHttpTransport } from "../http.js";
import { SteamEndpoints } from "../endpoints.js";
import { SteamError } from "../errors.js";
import { resolveToSteamId64 } from "../internal-resolve.js";
import type {
  ActivityFeedResult,
  BadgeEntry,
  BadgeQuest,
  BadgesResult,
  CommentsResult,
  CommunityBadgeProgress,
  Friend,
  FriendListResult,
  PlayerBan,
  PlayerSummary,
  ProfileActivity,
  ProfileComment,
  SteamIdInput,
  UserGroup,
  UserGroupListResult,
} from "../types.js";

export class UserApi {
  constructor(private readonly transport: SteamHttpTransport) {}

  /**
   * 批量获取玩家资料摘要(GetPlayerSummaries/v2,最多 100 个)。
   * 输入可为 steamID64 / steamID3 / steamID2 / 资料页 URL / vanity(vanity 自动解析,需 key)。
   */
  async getSummaries(steamIds: SteamIdInput[]): Promise<PlayerSummary[]> {
    if (steamIds.length === 0) {
      return [];
    }
    const ids = await Promise.all(steamIds.map((id) => resolveToSteamId64(id, this.transport)));
    const body = await this.transport.request<{ response: { players: PlayerSummary[] } }>({
      host: "api",
      path: SteamEndpoints.api.playerSummaries,
      params: { steamids: ids.join(",") },
      withKey: true,
    });
    return body.response.players;
  }

  /** vanity → steamID64(ResolveVanityURL/v1,需 key);未找到抛 NOT_FOUND。 */
  async resolveVanity(vanity: string): Promise<string> {
    const body = await this.transport.request<{
      response: { success: number; steamid?: string; message?: string };
    }>({
      host: "api",
      path: SteamEndpoints.api.resolveVanityUrl,
      params: { vanityurl: vanity, url_type: 1 },
      withKey: true,
    });
    if (body.response.success !== 1 || body.response.steamid === undefined) {
      throw new SteamError("NOT_FOUND", `vanity 未找到: ${vanity}`);
    }
    return body.response.steamid;
  }

  /** 批量查询封禁信息(GetPlayerBans/v1;注意该接口无 response 包装)。 */
  async getPlayerBans(steamIds: SteamIdInput[]): Promise<PlayerBan[]> {
    if (steamIds.length === 0) {
      return [];
    }
    const ids = await Promise.all(steamIds.map((id) => resolveToSteamId64(id, this.transport)));
    const body = await this.transport.request<{ players: PlayerBan[] }>({
      host: "api",
      path: SteamEndpoints.api.playerBans,
      params: { steamids: ids.join(",") },
      withKey: true,
    });
    return body.players;
  }

  /** 好友列表(GetFriendList/v1,需 key);目标资料未公开 → 空结果 + privacyRestricted 标记。 */
  async getFriendList(
    steamid: SteamIdInput,
    options: { relationship?: "friend" | "all" } = {},
  ): Promise<FriendListResult> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const params: Record<string, string | number | undefined> = { steamid: id64 };
    if (options.relationship !== undefined) {
      params.relationship = options.relationship;
    }
    let body: { friendslist?: { friends?: Friend[] } };
    try {
      body = await this.transport.request<{ friendslist?: { friends?: Friend[] } }>({
        host: "api",
        path: SteamEndpoints.api.friendList,
        params,
        withKey: true,
      });
    } catch (error) {
      if (error instanceof SteamError && error.code === "FORBIDDEN") {
        return { friends: [], privacyRestricted: true };
      }
      throw error;
    }
    const friends = body.friendslist?.friends ?? [];
    let privacyRestricted = false;
    if (friends.length === 0) {
      try {
        const summaries = await this.getSummaries([id64]);
        const summary = summaries[0];
        if (summary !== undefined && summary.communityvisibilitystate !== 3) {
          privacyRestricted = true;
        }
      } catch {
        // 忽略辅助判断失败
      }
    }
    return { friends, privacyRestricted };
  }

  /** 玩家等级(GetSteamLevel/v1,需 key)。 */
  async getSteamLevel(steamid: SteamIdInput): Promise<number> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const body = await this.transport.request<{ response: { player_level: number } }>({
      host: "api",
      path: SteamEndpoints.api.steamLevel,
      params: { steamid: id64 },
      withKey: true,
    });
    return body.response.player_level;
  }

  /** 玩家徽章(GetBadges/v1,需 key)。 */
  async getBadges(steamid: SteamIdInput): Promise<BadgesResult> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const body = await this.transport.request<{
      response: {
        badges?: BadgeEntry[];
        player_xp: number;
        player_level: number;
        player_xp_needed_to_current_level?: number;
        player_xp_needed_to_next_level?: number;
      };
    }>({
      host: "api",
      path: SteamEndpoints.api.badges,
      params: { steamid: id64 },
      withKey: true,
    });
    const r = body.response;
    return {
      badges: r.badges ?? [],
      playerXp: r.player_xp,
      playerLevel: r.player_level,
      playerXpNeededToCurrentLevel: r.player_xp_needed_to_current_level ?? 0,
      playerXpNeededToNextLevel: r.player_xp_needed_to_next_level ?? 0,
    };
  }

  /** 徽章任务进度(GetCommunityBadgeProgress/v1,需 key)。 */
  async getCommunityBadgeProgress(steamid: SteamIdInput, badgeid: number): Promise<CommunityBadgeProgress> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const body = await this.transport.request<{
      response: { badgeid: number; quests: BadgeQuest[] };
    }>({
      host: "api",
      path: SteamEndpoints.api.badgeProgress,
      params: { steamid: id64, badgeid },
      withKey: true,
    });
    return { badgeid: body.response.badgeid, quests: body.response.quests };
  }

  /** 玩家群组列表(GetUserGroupList/v1,需 key)。 */
  async getUserGroupList(steamid: SteamIdInput): Promise<UserGroupListResult> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const body = await this.transport.request<{
      response: { success: boolean; groups?: UserGroup[] };
    }>({
      host: "api",
      path: SteamEndpoints.api.userGroupList,
      params: { steamid: id64 },
      withKey: true,
    });
    return { groups: body.response.groups ?? [] };
  }

  /**
   * 动态流(资料页 XML 的 recentActivity,公开读)。
   * 资料无公开动态时返回空数组。
   */
  async getActivityFeed(steamid: SteamIdInput): Promise<ActivityFeedResult> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const xml = await this.transport.request<string>({
      host: "community",
      path: SteamEndpoints.community.profileXml(id64),
      rawText: true,
      noCache: true,
    });
    const activities: ProfileActivity[] = [];
    const block = /<recentActivity>([\s\S]*?)<\/recentActivity>/.exec(xml);
    if (block !== null) {
      const activityRe = /<activity>([\s\S]*?)<\/activity>/g;
      let match: RegExpExecArray | null;
      while ((match = activityRe.exec(block[1]!)) !== null) {
        const raw = match[1]!;
        const field = (name: string): string | undefined => {
          const m = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`).exec(raw);
          return m?.[1];
        };
        const entry: ProfileActivity = { raw };
        const eventType = field("eventType");
        const gameID = field("gameID");
        const webLink = field("webLink");
        const steamLink = field("steamLink");
        const unixTime = field("unixTime");
        if (eventType !== undefined) entry.eventType = eventType;
        if (gameID !== undefined) entry.gameID = gameID;
        if (webLink !== undefined) entry.webLink = webLink;
        if (steamLink !== undefined) entry.steamLink = steamLink;
        if (unixTime !== undefined) entry.unixTime = unixTime;
        activities.push(entry);
      }
    }
    return { steamid: id64, activities };
  }

  /**
   * 资料评论(community comment render,公开读;norender=1 返回 comments JSON)。
   * 仅 Profile 特性;评论区不可见时返回空。
   */
  async getComments(
    steamid: SteamIdInput,
    options: { count?: number; start?: number; totalCount?: number } = {},
  ): Promise<CommentsResult> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const body = await this.transport.request<{
      success: boolean;
      total_count: number;
      comments_html?: string;
      timestep?: number;
    }>({
      host: "community",
      path: SteamEndpoints.community.commentRender("Profile", id64),
      method: "POST",
      params: { norender: 1 },
      form: {
        count: options.count ?? 10,
        start: options.start ?? 0,
        totalcount: options.totalCount ?? 0,
        feature2: -1,
        feature3: -1,
      },
      noCache: true,
    });
    const comments: ProfileComment[] = [];
    if (typeof body.comments_html === "string" && body.comments_html.startsWith("[")) {
      try {
        const parsed = JSON.parse(body.comments_html) as ProfileComment[];
        comments.push(...parsed);
      } catch {
        // comments_html 非 JSON 时跳过(评论区渲染为 HTML 的情况)
      }
    }
    return { totalCount: body.total_count, comments };
  }
}
