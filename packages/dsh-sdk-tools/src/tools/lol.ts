import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createLolClient } from "@sakurachiyo0v0/lol";
import type { LolConfig } from "../config.js";
import { describeError } from "../errors.js";

/** 按名称或当前登录召唤师解析一个 puuid。 */
async function resolvePuuid(name?: string): Promise<{ puuid: string; displayName: string }> {
  const client = await createLolClient();
  try {
    if (name === undefined) {
      const current = await client.summoner.getCurrent();
      return { puuid: current.puuid, displayName: current.displayName };
    }
    const summoner = await client.summoner.getByName(name);
    return { puuid: summoner.puuid, displayName: summoner.displayName };
  } finally {
    await client.close();
  }
}

/** 注册 lol 工具(summoner / match_history / ranked)。 */
export function applyLolTools(ctx: Context, config: LolConfig): () => void {
  const disposers: Array<() => void> = [];
  void config;

  disposers.push(ctx.tools.register(defineTool({
    name: "lol_summoner",
    description: "查询英雄联盟召唤师信息(当前登录召唤师或按名称查询)。需要本机正在运行英雄联盟客户端。",
    parameters: {
      name: { type: "string", description: "召唤师名称;缺省返回当前登录召唤师" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          displayName: { type: "string", required: true },
          summonerId: { type: "number", required: true },
          summonerLevel: { type: "number", required: true },
          profileIconId: { type: "number", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `${value.displayName} (Lv.${value.summonerLevel}, 头像 ${value.profileIconId}, summonerId=${value.summonerId})`,
      }],
    },
    async execute(args) {
      try {
        const client = await createLolClient();
        try {
          if (args.name === undefined) {
            const current = await client.summoner.getCurrent();
            return {
              displayName: current.displayName,
              summonerId: current.summonerId,
              summonerLevel: current.summonerLevel,
              profileIconId: current.profileIconId,
            };
          }
          const summoner = await client.summoner.getByName(args.name);
          return {
            displayName: summoner.displayName,
            summonerId: summoner.summonerId,
            summonerLevel: summoner.summonerLevel,
            profileIconId: summoner.profileIconId,
          };
        } finally {
          await client.close();
        }
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  })));

  disposers.push(ctx.tools.register(defineTool({
    name: "lol_match_history",
    description: "查询召唤师最近战绩列表(最近 20 场,含英雄/模式/时长/结果)。需要本机正在运行英雄联盟客户端。",
    parameters: {
      name: { type: "string", description: "召唤师名称;缺省为当前登录召唤师" },
      count: { type: "number", description: "查询场数,默认 20" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          displayName: { type: "string", required: true },
          gameCount: { type: "number", required: true },
          games: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                gameId: { type: "number", required: true },
                mode: { type: "string", required: true },
                queueName: { type: "string" },
                duration: { type: "number", required: true },
                creation: { type: "number", required: true },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `${value.displayName} 共 ${value.gameCount} 场,返回 ${value.games.length} 场:\n`
          + value.games.map((game) => {
            const date = new Date(game.creation).toISOString().slice(0, 10);
            return `- ${date} [${game.mode}] ${Math.floor(game.duration / 60)}min (gameId=${game.gameId})`;
          }).join("\n"),
      }],
    },
    async execute(args) {
      try {
        const { puuid, displayName } = await resolvePuuid(args.name);
        const client = await createLolClient();
        try {
          const endIndex = args.count === undefined ? 20 : Math.max(0, Math.floor(args.count));
          const history = await client.matchHistory.getMatches(puuid, { begIndex: 0, endIndex });
          return {
            displayName,
            gameCount: history.gameCount,
            games: history.games.map((game) => ({
              gameId: game.gameId,
              mode: game.gameMode,
              ...game.queue !== undefined ? { queueName: game.queue.name } : {},
              duration: game.gameDuration,
              creation: game.gameCreation,
            })),
          };
        } finally {
          await client.close();
        }
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  })));

  disposers.push(ctx.tools.register(defineTool({
    name: "lol_ranked",
    description: "查询召唤师段位统计(单双排/灵活组排等队列的段位/胜点/胜负数)。需要本机正在运行英雄联盟客户端。",
    parameters: {
      name: { type: "string", description: "召唤师名称;缺省为当前登录召唤师" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          displayName: { type: "string", required: true },
          queues: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                queueType: { type: "string", required: true },
                tier: { type: "string", required: true },
                rank: { type: "string", required: true },
                leaguePoints: { type: "number", required: true },
                wins: { type: "number", required: true },
                losses: { type: "number", required: true },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `${value.displayName} 段位:\n` + value.queues.map((queue) => (
          `- ${queue.queueType}: ${queue.tier} ${queue.rank} ${queue.leaguePoints}LP (${queue.wins}胜 ${queue.losses}负)`
        )).join("\n"),
      }],
    },
    async execute(args) {
      try {
        const { puuid, displayName } = await resolvePuuid(args.name);
        const client = await createLolClient();
        try {
          const stats = await client.ranked.getStats(puuid);
          return {
            displayName,
            queues: stats.queues.map((queue) => ({
              queueType: queue.queueType,
              tier: queue.tier,
              rank: queue.rank,
              leaguePoints: queue.leaguePoints,
              wins: queue.wins,
              losses: queue.losses,
            })),
          };
        } finally {
          await client.close();
        }
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  })));

  return () => { for (const dispose of disposers) dispose(); };
}
