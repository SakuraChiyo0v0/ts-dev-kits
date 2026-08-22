/**
 * 对局流程模块：游戏状态机、匹配队列、秒退、重连、观战。
 */

import type { GameflowPhase, GameflowSession, ReadyCheck } from "../types.js";
import { LolError } from "../errors.js";
import type { LcuTransport } from "../transport.js";

export class GameflowApi {
  constructor(private readonly transport: LcuTransport) {}

  /** 当前对局阶段：None / Lobby / Matchmaking / ReadyCheck / ChampSelect / InProgress … */
  getPhase(): Promise<GameflowPhase> {
    return this.transport.request<GameflowPhase>({
      method: "GET",
      path: "/lol-gameflow/v1/gameflow-phase",
    });
  }

  /** 对局会话（进行中/已创建的对局信息） */
  getSession(): Promise<GameflowSession> {
    return this.transport.request<GameflowSession>({
      method: "GET",
      path: "/lol-gameflow/v1/session",
    });
  }

  /** 匹配确认状态 */
  getReadyCheck(): Promise<ReadyCheck> {
    return this.transport.request<ReadyCheck>({
      method: "GET",
      path: "/lol-matchmaking/v1/ready-check",
    });
  }

  /** 接受对局 */
  acceptReadyCheck(): Promise<void> {
    return this.transport.request<void>({
      method: "POST",
      path: "/lol-matchmaking/v1/ready-check/accept",
    });
  }

  /** 秒退（离开选人/对局），有 dodge 惩罚，谨慎使用 */
  dodge(): Promise<void> {
    return this.transport.request<void>({
      method: "POST",
      path: "/lol-login/v1/session/invoke",
      json: {
        destination: "lcdsServiceProxy",
        method: "call",
        args: '["", "teambuilder-draft", "quitV2", ""]',
      },
    });
  }

  /** 重连当前对局 */
  reconnect(): Promise<void> {
    return this.transport.request<void>({
      method: "POST",
      path: "/lol-gameflow/v1/reconnect",
    });
  }

  /** 再来一局 */
  playAgain(): Promise<void> {
    return this.transport.request<void>({
      method: "POST",
      path: "/lol-lobby/v2/play-again",
    });
  }

  /**
   * 观战同区玩家（经客户端启动观战）。
   * 玩家不在游戏中时抛 NOT_FOUND。
   */
  async spectate(summonerName: string, puuid: string): Promise<void> {
    const raw = await this.transport.requestRaw({
      method: "POST",
      path: "/lol-spectator/v1/spectate/launch",
      json: {
        allowObserveMode: "ALL",
        dropInSpectateGameId: summonerName,
        gameQueueType: "",
        puuid,
      },
    });
    if (raw.body !== "" && raw.body !== undefined && raw.body !== null) {
      throw new LolError("NOT_FOUND", `召唤师「${summonerName}」当前不在游戏中`);
    }
  }
}
