/**
 * stats 域 —— 成就与统计(ISteamUserStats / IPlayerService)。
 */
import type { SteamHttpTransport } from "../http.js";
import { SteamEndpoints } from "../endpoints.js";
import { resolveToSteamId64 } from "../internal-resolve.js";
import type {
  AchievementPercentage,
  GameSchema,
  GameStatValue,
  PlayerAchievement,
  PlayerAchievementsResult,
  SchemaAchievement,
  SchemaStat,
  SteamIdInput,
  UserStatsResult,
} from "../types.js";

export interface GetPlayerStatsOptions {
  /** 成就本地化语言。 */
  language?: string;
}

export class StatsApi {
  constructor(private readonly transport: SteamHttpTransport) {}

  /** 成就/统计定义(GetSchemaForGame/v2,需 key)。 */
  async getSchemaForGame(appid: number, options: GetPlayerStatsOptions = {}): Promise<GameSchema> {
    const body = await this.transport.request<{
      game: {
        gameName: string;
        gameVersion: string;
        availableGameStats?: { achievements?: SchemaAchievement[]; stats?: SchemaStat[] };
      };
    }>({
      host: "api",
      path: SteamEndpoints.api.schemaForGame,
      params: {
        appid,
        ...(options.language !== undefined ? { language: options.language } : {}),
      },
      withKey: true,
    });
    const game = body.game;
    return {
      gameName: game.gameName,
      gameVersion: game.gameVersion,
      achievements: game.availableGameStats?.achievements ?? [],
      stats: game.availableGameStats?.stats ?? [],
    };
  }

  /** 玩家成就(GetPlayerAchievements/v1,需 key);资料非公开 → privacyRestricted,不抛错。 */
  async getPlayerAchievements(
    steamid: SteamIdInput,
    appid: number,
    options: GetPlayerStatsOptions = {},
  ): Promise<PlayerAchievementsResult> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const body = await this.transport.request<{
      playerstats: {
        success: boolean;
        steamID?: string;
        gameName?: string;
        error?: string;
        achievements?: PlayerAchievement[];
      };
    }>({
      host: "api",
      path: SteamEndpoints.api.playerAchievements,
      params: {
        steamid: id64,
        appid,
        ...(options.language !== undefined ? { l: options.language } : {}),
      },
      withKey: true,
    });
    const ps = body.playerstats;
    if (ps.success === false) {
      return { achievements: [], privacyRestricted: true };
    }
    return {
      ...(ps.steamID !== undefined ? { steamId: ps.steamID } : {}),
      ...(ps.gameName !== undefined ? { gameName: ps.gameName } : {}),
      achievements: ps.achievements ?? [],
      privacyRestricted: false,
    };
  }

  /** 玩家统计值(GetUserStatsForGame/v2,需 key)。 */
  async getUserStatsForGame(steamid: SteamIdInput, appid: number): Promise<UserStatsResult> {
    const id64 = await resolveToSteamId64(steamid, this.transport);
    const body = await this.transport.request<{
      playerstats: {
        steamID: string;
        gameName: string;
        success: boolean;
        achievements?: PlayerAchievement[];
        stats?: GameStatValue[];
      };
    }>({
      host: "api",
      path: SteamEndpoints.api.userStatsForGame,
      params: { steamid: id64, appid },
      withKey: true,
    });
    return {
      steamId: body.playerstats.steamID,
      gameName: body.playerstats.gameName,
      achievements: body.playerstats.achievements ?? [],
      stats: body.playerstats.stats ?? [],
    };
  }

  /** 全局成就解锁百分比(GetGlobalAchievementPercentagesForApp/v2,无需 key;参数名为 gameid)。 */
  async getGlobalAchievementPercentages(appid: number): Promise<AchievementPercentage[]> {
    const body = await this.transport.request<{
      achievementpercentages: { achievements: AchievementPercentage[] };
    }>({
      host: "api",
      path: SteamEndpoints.api.globalAchievementPercentages,
      params: { gameid: appid },
    });
    return body.achievementpercentages.achievements;
  }

  /** 全局统计聚合(GetGlobalStatsForGame/v1,需 key;数组参数 name[0..n])。 */
  async getGlobalStats(
    appid: number,
    statNames: string[],
  ): Promise<Record<string, { total: number }>> {
    const params: Record<string, string | number | undefined> = { appid, count: statNames.length };
    statNames.forEach((name, index) => {
      params[`name[${index}]`] = name;
    });
    const body = await this.transport.request<{
      response: { globalstats?: Record<string, { total: number }> };
    }>({
      host: "api",
      path: SteamEndpoints.api.globalStatsForGame,
      params,
      withKey: true,
    });
    return body.response.globalstats ?? {};
  }

  /** 当前在线人数(GetNumberOfCurrentPlayers/v1,无需 key)。 */
  async getNumberOfCurrentPlayers(appid: number): Promise<number> {
    const body = await this.transport.request<{ response: { player_count: number; result: number } }>({
      host: "api",
      path: SteamEndpoints.api.numberOfCurrentPlayers,
      params: { appid },
    });
    return body.response.player_count;
  }
}
