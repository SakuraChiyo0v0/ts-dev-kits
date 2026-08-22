/**
 * @sakurachiyo0v0/lol — League of Legends LCU 本地能力 SDK。
 * 只导出稳定公共 API；内部实现细节不暴露。
 */

export { createLolClient } from "./client.js";
export type { LolClient } from "./client.js";

export { LolError, toLolError, sanitize } from "./errors.js";
export type { LolErrorCode, LolErrorOptions } from "./errors.js";

export { discoverLcuClient, parseCommandLine, isTencentServer, TENCENT_SERVERS } from "./discovery.js";
export type { DiscoveryOptions, ProcessReader } from "./discovery.js";

export { EventBus, EVENTS, EVENT_URIS } from "./events.js";
export { HttpLcuTransport } from "./http-transport.js";
export type { HttpTransportOptions } from "./http-transport.js";

export { SgpApi, sgpBaseUrl } from "./sgp.js";
export type { SgpOptions, SgpMatchRange } from "./sgp.js";

export { SummonerApi } from "./endpoints/summoner.js";
export type { SummonerProfile } from "./endpoints/summoner.js";
export { MatchHistoryApi } from "./endpoints/match-history.js";
export type { MatchRange } from "./endpoints/match-history.js";
export { RankedApi } from "./endpoints/ranked.js";
export { GameDataApi } from "./endpoints/game-data.js";
export type { IconItem, RuneItem } from "./endpoints/game-data.js";
export { GameflowApi } from "./endpoints/gameflow.js";
export { ChampSelectApi } from "./endpoints/champ-select.js";
export type {
  ChampSelectMySelection,
  SkinCarouselItem,
  RunePage,
  CreateRunePageOptions,
} from "./endpoints/champ-select.js";
export { LobbyApi } from "./endpoints/lobby.js";
export type { CreatePracticeLobbyOptions, Lobby } from "./endpoints/lobby.js";
export { ProfileApi } from "./endpoints/profile.js";
export type { RankedTier, RankShown } from "./endpoints/profile.js";
export { ChatApi } from "./endpoints/chat.js";
export type { Availability, ChatMe, Conversation } from "./endpoints/chat.js";
export { LiveClientApi, createLiveClient } from "./live-client.js";
export { ChampionNamesService, DEFAULT_CHAMPION_SOURCE_URL, BUILTIN_CHAMPION_NAMES } from "./champion-names.js";
export type { ChampionNamesOptions, ChampionNameMap } from "./champion-names.js";
export type {
  LiveClientOptions,
  ActivePlayer,
  PlayerInfo,
  PlayerScore,
  GameStats,
  GameEvent,
  AllGameData,
} from "./live-client.js";
export {
  parseMatchSummary,
  parseMatchesSummary,
  getRecentChampions,
  getTeammates,
  formatDuration,
  formatTimestamp,
  parseRankSummary,
  parseRankSummaryFromSgp,
} from "./parsers/index.js";
export type {
  MatchSummaryResult,
  ChampionStats,
  TeammatePlayer,
  TeammatesResult,
  RankDetail,
  RankSummary,
} from "./parsers/index.js";

export type { LcuTransport, RawResponse, RequestOptions, HttpMethod } from "./transport.js";

export type {
  LcuConnectionInfo,
  LolClientOptions,
  LcuEvent,
  LcuEventType,
  GameflowPhase,
  CurrentSummoner,
  Summoner,
  MatchHistoryGames,
  MatchSummary,
  GameDetail,
  SgpMatchHistory,
  SgpMatchGame,
  RankedStats,
  RankedQueueEntry,
  ReadyCheck,
  GameflowSession,
  ChampSelectAction,
  ChampSelectSession,
  ChampionSummary,
  QueueInfo,
} from "./types.js";
