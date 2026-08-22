/**
 * 对局解析：把 raw 战绩 JSON 转成友好的结构化摘要。
 * 纯函数，无 IO；口径参考 Seraphine tools.py。
 */

import type { GameDetail, MatchSummary } from "../types.js";

export interface MatchSummaryResult {
  gameId: number;
  queueId: number;
  mapId: number;
  /** 毫秒时间戳 */
  gameCreation: number;
  /** 秒 */
  gameDuration: number;
  win: boolean;
  /** 秒退/重开局（不计入胜率） */
  remake: boolean;
  championId: number;
  champLevel: number;
  kills: number;
  deaths: number;
  assists: number;
  /** "k/d/a" 形式 */
  kda: string;
  itemIds: number[];
  spell1Id: number;
  spell2Id: number;
}

export interface ChampionStats {
  championId: number;
  total: number;
  wins: number;
  losses: number;
}

export interface TeammatePlayer {
  summonerId: number;
  name: string;
  puuid: string;
  icon: number;
}

export interface TeammatesResult {
  queueId: number;
  win: boolean;
  remake: boolean;
  /** 目标玩家本局英雄；自定义对局可能缺失（-1） */
  championId: number;
  teammates: TeammatePlayer[];
  enemies: TeammatePlayer[];
}

/** 解析单场对局中指定玩家的表现摘要 */
export function parseMatchSummary(match: MatchSummary | GameDetail, puuid: string): MatchSummaryResult {
  const identities = match.participantIdentities ?? [];
  const identity = identities.find((i) => i.player.puuid === puuid);
  if (!identity) {
    throw new Error(`对局 ${match.gameId} 中找不到 puuid=${puuid} 的玩家`);
  }

  const participant = (match.participants ?? []).find(
    (p) => p.participantId === identity.participantId,
  );
  if (!participant) {
    throw new Error(`对局 ${match.gameId} 中找不到 participantId=${identity.participantId} 的数据`);
  }

  const stats = participant.stats as {
    champLevel?: number;
    kills?: number;
    deaths?: number;
    assists?: number;
    win?: boolean;
    teamEarlySurrendered?: boolean;
    item0?: number;
    item1?: number;
    item2?: number;
    item3?: number;
    item4?: number;
    item5?: number;
    item6?: number;
  };

  const kills = stats.kills ?? 0;
  const deaths = stats.deaths ?? 0;
  const assists = stats.assists ?? 0;

  return {
    gameId: match.gameId,
    queueId: match.queueId,
    mapId: match.mapId,
    gameCreation: match.gameCreation,
    gameDuration: match.gameDuration,
    win: stats.win ?? false,
    remake: stats.teamEarlySurrendered ?? false,
    championId: participant.championId,
    champLevel: stats.champLevel ?? 0,
    kills,
    deaths,
    assists,
    kda: `${kills}/${deaths}/${assists}`,
    itemIds: [
      stats.item0 ?? 0,
      stats.item1 ?? 0,
      stats.item2 ?? 0,
      stats.item3 ?? 0,
      stats.item4 ?? 0,
      stats.item5 ?? 0,
      stats.item6 ?? 0,
    ],
    spell1Id: participant.spell1Id,
    spell2Id: participant.spell2Id,
  };
}

/** 批量解析；解析失败的单场会被丢弃（调用方可先用过滤器预处理） */
export function parseMatchesSummary(matches: Array<MatchSummary | GameDetail>, puuid: string): MatchSummaryResult[] {
  const results: MatchSummaryResult[] = [];
  for (const match of matches) {
    try {
      results.push(parseMatchSummary(match, puuid));
    } catch {
      // 跳过数据不完整的对局
    }
  }
  return results;
}

/**
 * 常用英雄统计：按 championId 聚合。
 * 跳过自定义对局（queueId=0）；秒退/重开局不计输赢；按场次降序取前 limit。
 */
export function getRecentChampions(results: MatchSummaryResult[], limit = 10): ChampionStats[] {
  const byChampion = new Map<number, ChampionStats>();

  for (const r of results) {
    if (r.queueId === 0) {
      continue;
    }
    let entry = byChampion.get(r.championId);
    if (!entry) {
      entry = { championId: r.championId, total: 0, wins: 0, losses: 0 };
      byChampion.set(r.championId, entry);
    }
    entry.total += 1;
    if (!r.remake) {
      if (r.win) {
        entry.wins += 1;
      } else {
        entry.losses += 1;
      }
    }
  }

  return [...byChampion.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/** 提取目标玩家在对局中的队友与对手（竞技场按 subteamPlacement 分组） */
export function getTeammates(match: GameDetail, targetPuuid: string): TeammatesResult {
  const identities = match.participantIdentities ?? [];
  const targetIdentity = identities.find((i) => i.player.puuid === targetPuuid);
  if (!targetIdentity) {
    throw new Error(`对局 ${match.gameId} 中找不到 puuid=${targetPuuid} 的玩家`);
  }

  const targetParticipant = (match.participants ?? []).find(
    (p) => p.participantId === targetIdentity.participantId,
  );
  if (!targetParticipant) {
    throw new Error(`对局 ${match.gameId} 中找不到 participantId=${targetIdentity.participantId} 的数据`);
  }

  const isArena = match.queueId === 1700;
  const groupOf = (p: { teamId: number; stats: Record<string, unknown> }): number =>
    isArena ? ((p.stats.subteamPlacement as number) ?? -1) : p.teamId;

  const targetGroup = groupOf(targetParticipant);
  const stats = targetParticipant.stats as {
    win?: boolean;
    teamEarlySurrendered?: boolean;
  };

  const result: TeammatesResult = {
    queueId: match.queueId,
    win: stats.win ?? false,
    remake: stats.teamEarlySurrendered ?? false,
    championId: targetParticipant.championId,
    teammates: [],
    enemies: [],
  };

  for (const player of match.participants ?? []) {
    const identity = identities.find((i) => i.participantId === player.participantId);
    if (!identity) {
      continue;
    }
    const s = identity.player;
    const entry: TeammatePlayer = {
      summonerId: s.summonerId,
      name: s.summonerName,
      puuid: s.puuid,
      icon: s.profileIcon,
    };
    if (groupOf(player) === targetGroup) {
      if (s.puuid !== targetPuuid) {
        result.teammates.push(entry);
      }
    } else {
      result.enemies.push(entry);
    }
  }

  return result;
}

/** 秒 → "mm:ss"（超过 1 小时 → "h:mm:ss"） */
export function formatDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 毫秒时间戳 → 本地时间 "YYYY-MM-DD HH:mm" */
export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
