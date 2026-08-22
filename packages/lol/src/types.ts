/**
 * LCU 领域类型。端点返回的 raw JSON 原样透传，类型只做描述，不做运行时清洗。
 */

/** LCU 连接参数：从客户端进程命令行解析所得 */
export interface LcuConnectionInfo {
  pid: number;
  /** --app-port */
  port: number;
  /** --remoting-auth-token */
  token: string;
  /** --rso_platform_id，如 "HN1"；国际服可能缺失 */
  server?: string;
}

export interface LolClientOptions {
  /**
   * 显式指定连接参数。省略时自动发现本机 LCU。
   * 测试或本机多客户端场景传入。
   */
  connection?: LcuConnectionInfo;
  /** 并发请求上限（信号量），默认 8 */
  concurrency?: number;
  /** 请求超时（毫秒），默认 15000 */
  timeoutMs?: number;
  /** 传输层协议，默认 https（真实客户端）；测试用 http 指向本地 mock 服务器 */
  scheme?: "http" | "https";
}

/** LCU WebSocket 事件类型 */
export type LcuEventType = "Create" | "Update" | "Delete";

/** LCU WebSocket 事件负载（payload = [8, "OnJsonApiEvent_...", LcuEvent]） */
export interface LcuEvent {
  uri: string;
  eventType: LcuEventType;
  data: unknown;
}

export type GameflowPhase =
  | "None"
  | "Lobby"
  | "Matchmaking"
  | "ReadyCheck"
  | "ChampSelect"
  | "GameStart"
  | "FailedToLaunch"
  | "InProgress"
  | "Reconnect"
  | "WaitingForStats"
  | "PreEndOfGame"
  | "EndOfGame"
  | "TerminatedInError";

// ---------- 召唤师 ----------

/** /lol-summoner/v1/current-summoner */
export interface CurrentSummoner {
  accountId: number;
  displayName: string;
  internalName: string;
  nameChangeFlag: boolean;
  percentCompleteForNextLevel: number;
  privacy: string;
  profileIconId: number;
  puuid: string;
  rerollPoints: { currentPoints: number; pointsCostToRoll: number; pointsToNextReroll: number };
  summonerId: number;
  summonerLevel: number;
  unnamed: boolean;
  xpSinceLastLevel: number;
  xpUntilNextLevel: number;
  [key: string]: unknown;
}

/** /lol-summoner/v1/summoners 与 /lol-summoner/v2/summoners/puuid/{puuid} */
export interface Summoner {
  accountId: number;
  displayName: string;
  gameName: string;
  internalName: string;
  nameChangeFlag: boolean;
  percentCompleteForNextLevel: number;
  privacy: string;
  profileIconId: number;
  puuid: string;
  rerollPoints: { currentPoints: number; pointsCostToRoll: number; pointsToNextReroll: number };
  summonerId: number;
  summonerLevel: number;
  tagLine: string;
  unnamed: boolean;
  xpSinceLastLevel: number;
  xpUntilNextLevel: number;
  [key: string]: unknown;
}

// ---------- 战绩 ----------

/** /lol-match-history/v1/products/lol/{puuid}/matches 中 games 字段 */
export interface MatchHistoryGames {
  gameCount: number;
  gameIndexBegin: number;
  gameIndexEnd: number;
  games: MatchSummary[];
  [key: string]: unknown;
}

export interface MatchSummary {
  gameCreation: number;
  gameCreationDate: string;
  gameDuration: number;
  gameId: number;
  gameMode: string;
  gameType: string;
  gameVersion: string;
  mapId: number;
  participantIdentities: Array<{
    player: { accountId: number; currentAccountId: number; currentPlatformId: string; matchHistoryUri: string; platformId: string; profileIcon: number; puuid: string; summonerId: number; summonerName: string };
    participantId: number;
    [key: string]: unknown;
  }>;
  participants: Array<{
    championId: number;
    highestAchievedSeasonTier: string;
    participantId: number;
    spell1Id: number;
    spell2Id: number;
    stats: Record<string, unknown>;
    teamId: number;
    timeline: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  platformId: string;
  queueId: number;
  queue: { id: number; mapId: number; name: string; [key: string]: unknown };
  seasonId: number;
  [key: string]: unknown;
}

/** /lol-match-history/v1/games/{gameId} */
export interface GameDetail extends MatchSummary {
  teams: Array<{
    teamId: number;
    win: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

// ---------- 段位 ----------

/** SGP SUMMARY 战绩响应（/match-history-query/v1/products/lol/player/{puuid}/SUMMARY），真实结构为 { games: [...] } */
export interface SgpMatchHistory {
  games: SgpMatchGame[];
  [key: string]: unknown;
}

/** SGP 单场战绩（metadata/info 格式，与 LCU 的 participantIdentities/participants 结构不同） */
export interface SgpMatchGame {
  metadata: {
    product: string;
    tags: string[];
    /** 全部参赛者 puuid 列表 */
    participants: string[];
    /** 毫秒时间戳 */
    timestamp: string;
    data_version: string;
    info_type: string;
    /** 形如 "HN1_11216506786"（含服务器前缀） */
    match_id: string;
    private: boolean;
    [key: string]: unknown;
  };
  info?: Record<string, unknown>;
  [key: string]: unknown;
}

/** /lol-ranked/v1/ranked-stats/{puuid} */
export interface RankedStats {
  queues: RankedQueueEntry[];
  [key: string]: unknown;
}

export interface RankedQueueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  provisionalGamesRemaining: number;
  miniSeries: { losses: number; progress: string; target: number; wins: number; [key: string]: unknown } | null;
  [key: string]: unknown;
}

// ---------- 对局流程 ----------

export interface ReadyCheck {
  declinerIds: number[];
  dodgeWarning: string;
  playerResponse: "None" | "Accepted" | "Declined";
  state: "Invalid" | "InProgress" | "EveryoneReady" | "StrangerNotReady" | "PartyNotReady";
  [key: string]: unknown;
}

/** /lol-gameflow/v1/session */
export interface GameflowSession {
  gameClient: { running: boolean; visible: boolean; [key: string]: unknown };
  gameData: {
    gameId: number;
    gameName: string;
    gameMode: string;
    gameType: string;
    gameMutator: string;
    mapId: number;
    [key: string]: unknown;
  };
  gameDodge: { dodgeWarning: string; dodgerId: number; phase: string; state: string; [key: string]: unknown } | null;
  gameKey: { gameId: number; gameHash: string; region: string; [key: string]: unknown };
  gameMap: { assets: Record<string, unknown>; [key: string]: unknown };
  gameQueue: { gameQueueConfigId: number; queueType: string; [key: string]: unknown } | null;
  [key: string]: unknown;
}

// ---------- 选人 ----------

export interface ChampSelectAction {
  actorCellId: number;
  championId: number;
  completed: boolean;
  id: number;
  isAllyAction: boolean;
  isInProgress: boolean;
  pickTurn: number;
  type: "ban" | "pick" | "ten_bans_reveal";
  [key: string]: unknown;
}

export interface ChampSelectSession {
  actions: ChampSelectAction[][];
  allowBattleBoost: boolean;
  allowDuplicatePicks: boolean;
  allowLockedEvents: boolean;
  allowRerolling: boolean;
  allowSkinSelection: boolean;
  benchChampionIds: number[];
  benchEnabled: boolean;
  boostableSkinCount: number;
  chatDetails: { multiUserChatId: string; multiUserChatPassword: string; [key: string]: unknown };
  counter: number;
  localPlayerCellId: number;
  lockedEventIndex: number;
  myTeam: Array<Record<string, unknown>>;
  theirTeam: Array<Record<string, unknown>>;
  timer: { adjustedTimeLeftInPhase: number; internalNowInEpochMs: number; isInfinite: boolean; phase: string; totalTimeInPhase: number; [key: string]: unknown };
  trades: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

// ---------- 游戏数据 ----------

export interface ChampionSummary {
  id: number;
  name: string;
  alias: string;
  squarePortraitPath: string;
  roles: string[];
  [key: string]: unknown;
}

export interface QueueInfo {
  id: number;
  mapId: number;
  name: string;
  [key: string]: unknown;
}
