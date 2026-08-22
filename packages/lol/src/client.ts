/**
 * LolClient 门面：统一入口。自动发现本机 LCU 并建立 REST + WebSocket 连接，
 * 领域能力以 client.summoner / matchHistory / ranked / gameData / gameflow 提供。
 */

import { discoverLcuClient, isTencentServer } from "./discovery.js";
import { HttpLcuTransport } from "./http-transport.js";
import { EventBus } from "./events.js";
import { SgpApi } from "./sgp.js";
import { SummonerApi } from "./endpoints/summoner.js";
import { MatchHistoryApi } from "./endpoints/match-history.js";
import { RankedApi } from "./endpoints/ranked.js";
import { GameDataApi } from "./endpoints/game-data.js";
import { GameflowApi } from "./endpoints/gameflow.js";
import { ChampSelectApi } from "./endpoints/champ-select.js";
import { LobbyApi } from "./endpoints/lobby.js";
import { ProfileApi } from "./endpoints/profile.js";
import { ChatApi } from "./endpoints/chat.js";
import { LiveClientApi } from "./live-client.js";
import type { LcuConnectionInfo, LolClientOptions } from "./types.js";

export interface LolClient {
  /** 当前连接的 LCU 信息（含 server，若有） */
  readonly connection: LcuConnectionInfo;
  /** 事件订阅 */
  readonly events: EventBus;
  readonly summoner: SummonerApi;
  readonly matchHistory: MatchHistoryApi;
  readonly ranked: RankedApi;
  readonly gameData: GameDataApi;
  readonly gameflow: GameflowApi;
  readonly champSelect: ChampSelectApi;
  readonly lobby: LobbyApi;
  readonly profile: ProfileApi;
  readonly chat: ChatApi;
  /** 游戏内 Live Client Data（端口 2999，游戏进行中时可用） */
  readonly liveClient: LiveClientApi;
  /** 腾讯国服 SGP 通道；非国服为 undefined */
  readonly sgp?: SgpApi;
  /** 关闭传输层（HTTP 会话 + WebSocket + SGP 会话） */
  close(): Promise<void>;
}

/**
 * 创建客户端。默认自动发现本机正在运行的英雄联盟客户端；
 * 传入 options.connection 可显式指定（测试/多客户端）。
 */
export async function createLolClient(options: LolClientOptions = {}): Promise<LolClient> {
  const connection =
    options.connection ?? (await discoverLcuClient());

  const transport = new HttpLcuTransport({
    port: connection.port,
    token: connection.token,
    ...(options.scheme ? { scheme: options.scheme } : {}),
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });

  const events = new EventBus(transport);

  // SGP 通道：仅腾讯国服启用；token 从 /entitlements/v1/token 获取并随事件刷新
  let sgpToken: string | undefined;
  let sgp: SgpApi | undefined;
  const server = connection.server;
  if (server !== undefined && isTencentServer(server)) {
    try {
      const entitlements = await transport.request<{ accessToken?: string }>({
        method: "GET",
        path: "/entitlements/v1/token",
      });
      sgpToken = entitlements.accessToken;
    } catch {
      sgpToken = undefined;
    }
    events.onSgpToken((token) => {
      sgpToken = token;
    });
    sgp = new SgpApi({
      server,
      getToken: async () => {
        if (!sgpToken) {
          const entitlements = await transport.request<{ accessToken?: string }>({
            method: "GET",
            path: "/entitlements/v1/token",
          });
          sgpToken = entitlements.accessToken;
        }
        return sgpToken!;
      },
    });
  }

  const client: LolClient = {
    connection,
    events,
    summoner: new SummonerApi(transport),
    matchHistory: new MatchHistoryApi(transport, sgp ?? null),
    ranked: new RankedApi(transport, sgp ?? null),
    gameData: new GameDataApi(transport),
    gameflow: new GameflowApi(transport),
    champSelect: new ChampSelectApi(transport),
    lobby: new LobbyApi(transport),
    profile: new ProfileApi(transport),
    chat: new ChatApi(transport),
    liveClient: new LiveClientApi(),
    ...(sgp ? { sgp } : {}),
    async close() {
      await transport.close();
      await client.liveClient.close();
      if (sgp) {
        await sgp.close();
      }
    },
  };

  return client;
}
