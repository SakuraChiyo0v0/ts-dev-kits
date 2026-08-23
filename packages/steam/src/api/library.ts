/**
 * library 域 —— 游戏库(IPlayerService)。
 * 2023.10 起 GetOwnedGames 只返回目标资料为公开的游戏;空结果可能因隐私,
 * 通过 profile 可见性做启发式标记(privacyRestricted),不抛错。
 */
import type { SteamHttpTransport } from "../http.js";
import { SteamEndpoints } from "../endpoints.js";
import { SteamError } from "../errors.js";
import { resolveToSteamId64 } from "../internal-resolve.js";
import type {
  OwnedGame,
  OwnedGamesResult,
  RecentlyPlayedGame,
  RecentlyPlayedResult,
  SteamIdInput,
  WishlistEntry,
  WishlistResult,
} from "../types.js";
import type { UserApi } from "./user.js";

export interface GetOwnedGamesOptions {
  /** 是否返回游戏名称/图标,默认 true。 */
  includeAppInfo?: boolean;
  /** 是否包含免费游戏,默认 false。 */
  includePlayedFreeGames?: boolean;
  /** 只返回指定 appid 子集。 */
  appidsFilter?: number[];
  /** 本地化语言(如 schinese)。 */
  language?: string;
}

export class LibraryApi {
  constructor(
    private readonly transport: SteamHttpTransport,
    private readonly user: UserApi,
  ) {}

  /** 游戏库(GetOwnedGames/v1,需 key)。 */
  async getOwnedGames(
    steamid: SteamIdInput,
    options: GetOwnedGamesOptions = {},
  ): Promise<OwnedGamesResult> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const params: Record<string, string | number | undefined> = {
      steamid: id64,
      include_appinfo: String(options.includeAppInfo ?? true),
      include_played_free_games: String(options.includePlayedFreeGames ?? false),
      ...(options.language !== undefined ? { language: options.language } : {}),
    };
    if (options.appidsFilter !== undefined && options.appidsFilter.length > 0) {
      params.appids_filter = options.appidsFilter.join(",");
    }

    const body = await this.transport.request<{
      response: { game_count: number; games?: OwnedGame[] };
    }>({
      host: "api",
      path: SteamEndpoints.api.ownedGames,
      params,
      withKey: true,
    });

    const games = body.response.games ?? [];
    let privacyRestricted = false;
    if (games.length === 0) {
      // 空结果可能是"真没游戏",也可能是目标资料未公开;用资料可见性辅助判断(失败不影响结果)。
      try {
        const summaries = await this.user.getSummaries([id64]);
        const summary = summaries[0];
        if (summary !== undefined && summary.communityvisibilitystate !== 3) {
          privacyRestricted = true;
        }
      } catch {
        // 忽略辅助判断失败
      }
    }
    return { gameCount: body.response.game_count, games, privacyRestricted };
  }

  /** 家庭共享判断(IsPlayingSharedGame/v1,需 key);返回借出者 steamID64,非共享为 undefined。 */
  async isPlayingSharedGame(steamid: SteamIdInput, appid: number): Promise<string | undefined> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const body = await this.transport.request<{ response: { lender_steamid?: string } }>({
      host: "api",
      path: SteamEndpoints.api.isPlayingSharedGame,
      params: { steamid: id64, appid_playing: appid },
      withKey: true,
    });
    return body.response.lender_steamid;
  }

  /** 近期玩过的游戏(GetRecentlyPlayedGames/v1,需 key)。 */
  async getRecentlyPlayedGames(
    steamid: SteamIdInput,
    options: { count?: number } = {},
  ): Promise<RecentlyPlayedResult> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const body = await this.transport.request<{
      response: { total_count: number; games?: RecentlyPlayedGame[] };
    }>({
      host: "api",
      path: SteamEndpoints.api.recentlyPlayedGames,
      params: {
        steamid: id64,
        ...(options.count !== undefined ? { count: options.count } : {}),
      },
      withKey: true,
    });
    return { totalCount: body.response.total_count, games: body.response.games ?? [] };
  }

  /** 愿望单(community wishlistdata,公开读,无需 key);未公开/不可读 → 空 + privacyRestricted。 */
  async getWishlist(steamid: SteamIdInput): Promise<WishlistResult> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    let text: string;
    try {
      // 用原始文本自行解析:community 对私密/被风控的愿望单返回通用 HTML 页面
      // (而非 JSON),若直接按 Record 解析会把 HTML 逐字符拆成垃圾条目。
      text = await this.transport.request<string>({
        host: "community",
        path: SteamEndpoints.community.wishlist(id64),
        noCache: true,
        rawText: true,
      });
    } catch (error) {
      if (error instanceof SteamError && error.code === "FORBIDDEN") {
        return { entries: {}, privacyRestricted: true };
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return { entries: {}, privacyRestricted: true };
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { entries: {}, privacyRestricted: true };
    }
    return { entries: parsed as Record<string, WishlistEntry>, privacyRestricted: false };
  }
}
