import { describe, expect, it } from "vitest";

import {
  formatDuration,
  formatTimestamp,
  getRecentChampions,
  getTeammates,
  parseMatchesSummary,
  parseMatchSummary,
  parseRankSummary,
  parseRankSummaryFromSgp,
  type GameDetail,
  type MatchSummary,
  type RankedStats,
} from "../src/index.js";

const ME_PUUID = "puuid-me";

function makeMatch(overrides: Partial<GameDetail> = {}): GameDetail {
  return {
    gameCreation: 1_700_000_000_000,
    gameCreationDate: "2023-11-14T22:13:20.000Z",
    gameDuration: 1500,
    gameId: 1,
    gameMode: "CLASSIC",
    gameType: "MATCHED_GAME",
    gameVersion: "13.22",
    mapId: 11,
    platformId: "HN1",
    queueId: 420,
    queue: { id: 420, mapId: 11, name: "Ranked Solo" },
    seasonId: 23,
    participantIdentities: [
      { participantId: 1, player: { accountId: 1, currentAccountId: 1, currentPlatformId: "HN1", matchHistoryUri: "", platformId: "HN1", profileIcon: 100, puuid: ME_PUUID, summonerId: 101, summonerName: "Me" } },
      { participantId: 2, player: { accountId: 2, currentAccountId: 2, currentPlatformId: "HN1", matchHistoryUri: "", platformId: "HN1", profileIcon: 200, puuid: "puuid-a", summonerId: 102, summonerName: "Ally" } },
      { participantId: 3, player: { accountId: 3, currentAccountId: 3, currentPlatformId: "HN1", matchHistoryUri: "", platformId: "HN1", profileIcon: 300, puuid: "puuid-e", summonerId: 103, summonerName: "Enemy1" } },
      { participantId: 4, player: { accountId: 4, currentAccountId: 4, currentPlatformId: "HN1", matchHistoryUri: "", platformId: "HN1", profileIcon: 400, puuid: "puuid-e2", summonerId: 104, summonerName: "Enemy2" } },
    ],
    participants: [
      { championId: 103, highestAchievedSeasonTier: "DIAMOND", participantId: 1, spell1Id: 4, spell2Id: 12, teamId: 100, timeline: {}, stats: { champLevel: 13, kills: 10, deaths: 2, assists: 8, win: true, teamEarlySurrendered: false, item0: 3158, item1: 3020 } },
      { championId: 111, highestAchievedSeasonTier: "DIAMOND", participantId: 2, spell1Id: 4, spell2Id: 14, teamId: 100, timeline: {}, stats: { champLevel: 12, kills: 3, deaths: 5, assists: 9, win: true, teamEarlySurrendered: false } },
      { championId: 121, highestAchievedSeasonTier: "DIAMOND", participantId: 3, spell1Id: 4, spell2Id: 12, teamId: 200, timeline: {}, stats: { champLevel: 11, kills: 5, deaths: 6, assists: 3, win: false, teamEarlySurrendered: false } },
      { championId: 122, highestAchievedSeasonTier: "DIAMOND", participantId: 4, spell1Id: 4, spell2Id: 12, teamId: 200, timeline: {}, stats: { champLevel: 10, kills: 2, deaths: 9, assists: 4, win: false, teamEarlySurrendered: false } },
    ],
    teams: [
      { teamId: 100, win: "Win" },
      { teamId: 200, win: "Fail" },
    ],
    ...overrides,
  };
}

describe("parseMatchSummary", () => {
  it("extracts KDA, win, champion and items", () => {
    const r = parseMatchSummary(makeMatch(), ME_PUUID);
    expect(r.gameId).toBe(1);
    expect(r.win).toBe(true);
    expect(r.remake).toBe(false);
    expect(r.kda).toBe("10/2/8");
    expect(r.championId).toBe(103);
    expect(r.champLevel).toBe(13);
    expect(r.spell1Id).toBe(4);
    expect(r.spell2Id).toBe(12);
    expect(r.itemIds).toEqual([3158, 3020, 0, 0, 0, 0, 0]);
    expect(r.gameDuration).toBe(1500);
  });

  it("throws for unknown puuid", () => {
    expect(() => parseMatchSummary(makeMatch(), "nobody")).toThrow(/找不到/);
  });

  it("skips broken matches in batch parse", () => {
    const broken = makeMatch();
    broken.participants = [];
    const results = parseMatchesSummary([makeMatch(), broken], ME_PUUID);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ gameId: 1 });
  });
});

describe("getRecentChampions", () => {
  const game = (championId: number, queueId: number, win: boolean, remake: boolean): MatchSummary => {
    const m = makeMatch({ queueId, gameId: championId * 10 + (win ? 1 : 0) });
    m.participants[0] = {
      ...m.participants[0]!,
      championId,
      stats: { ...m.participants[0]!.stats, win, teamEarlySurrendered: remake },
    };
    return m;
  };

  it("aggregates wins/losses and skips custom games", () => {
    const results = parseMatchesSummary(
      [
        game(1, 420, true, false),
        game(1, 420, false, false),
        game(1, 420, true, true), // remake 不计输赢
        game(2, 0, true, false), // 自定义跳过
        game(2, 420, true, false),
      ],
      ME_PUUID,
    );
    const champs = getRecentChampions(results);
    expect(champs[0]).toMatchObject({ championId: 1, total: 3, wins: 1, losses: 1 });
    expect(champs[1]).toMatchObject({ championId: 2, total: 1, wins: 1, losses: 0 });
    expect(champs).toHaveLength(2);
  });

  it("respects limit", () => {
    const results = parseMatchesSummary([game(1, 420, true, false), game(2, 420, true, false)], ME_PUUID);
    expect(getRecentChampions(results, 1)).toHaveLength(1);
  });
});

describe("getTeammates", () => {
  it("splits teammates and enemies", () => {
    const r = getTeammates(makeMatch(), ME_PUUID);
    expect(r.win).toBe(true);
    expect(r.championId).toBe(103);
    expect(r.teammates).toEqual([
      { summonerId: 102, name: "Ally", puuid: "puuid-a", icon: 200 },
    ]);
    expect(r.enemies).toEqual([
      { summonerId: 103, name: "Enemy1", puuid: "puuid-e", icon: 300 },
      { summonerId: 104, name: "Enemy2", puuid: "puuid-e2", icon: 400 },
    ]);
  });

  it("groups by subteamPlacement in arena", () => {
    const match = makeMatch({ queueId: 1700 });
    match.participants = match.participants.map((p, i) => ({
      ...p,
      stats: { ...p.stats, subteamPlacement: i < 2 ? 1 : 2 },
    }));
    const r = getTeammates(match, ME_PUUID);
    expect(r.teammates).toEqual([
      { summonerId: 102, name: "Ally", puuid: "puuid-a", icon: 200 },
    ]);
    expect(r.enemies).toHaveLength(2);
  });
});

describe("rank parsers", () => {
  it("parses LCU queueMap format", () => {
    const stats = {
      queues: [],
      queueMap: {
        RANKED_SOLO_5x5: { tier: "DIAMOND", division: "II", leaguePoints: 43 },
        RANKED_FLEX_SR: { tier: "", division: "NA", leaguePoints: 0 },
      },
    } as unknown as RankedStats;
    const r = parseRankSummary(stats);
    expect(r.solo).toEqual({ tier: "DIAMOND", division: "II", lp: 43 });
    expect(r.flex).toEqual({ tier: "", division: "", lp: 0 });
  });

  it("parses SGP queues format", () => {
    const info = {
      queues: [
        { queueType: "RANKED_FLEX_SR", tier: "GOLD", rank: "IV", leaguePoints: 12 },
        { queueType: "RANKED_SOLO_5x5", tier: "PLATINUM", rank: "I", leaguePoints: 99 },
      ],
    };
    const r = parseRankSummaryFromSgp(info);
    expect(r.solo).toEqual({ tier: "PLATINUM", division: "I", lp: 99 });
    expect(r.flex).toEqual({ tier: "GOLD", division: "IV", lp: 12 });
  });

  it("handles missing queues gracefully", () => {
    expect(parseRankSummaryFromSgp(undefined)).toEqual({
      solo: { tier: "", division: "", lp: null },
      flex: { tier: "", division: "", lp: null },
    });
  });
});

describe("time helpers", () => {
  it("formats duration", () => {
    expect(formatDuration(42)).toBe("0:42");
    expect(formatDuration(1500)).toBe("25:00");
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(-5)).toBe("0:00");
  });

  it("formats timestamp", () => {
    // 固定 UTC+8 之外的本地时区不可靠，这里只断言格式形态
    expect(formatTimestamp(1_700_000_000_000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
