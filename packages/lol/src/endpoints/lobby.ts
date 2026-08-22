/**
 * 房间模块（P3）：自定义对局房间。
 */

import type { LcuTransport } from "../transport.js";

export interface CreatePracticeLobbyOptions {
  name: string;
  password?: string;
  /** 地图 ID，默认 11（召唤师峡谷） */
  mapId?: number;
  /** 队列 ID，默认 3100（练习工具/训练房）；新版客户端必填，缺失会 INVALID_LOBBY */
  queueId?: number;
}

export interface Lobby {
  gameConfig: {
    allowSpectators: string;
    gameMode: string;
    gameMutator: string;
    gameType: string;
    mapId: number;
    maxLobbySize: number;
    queueId: number;
    [key: string]: unknown;
  };
  localMember: { summonerId: number; [key: string]: unknown };
  members: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export class LobbyApi {
  constructor(private readonly transport: LcuTransport) {}

  /** 当前房间 */
  getLobby(): Promise<Lobby> {
    return this.transport.request<Lobby>({
      method: "GET",
      path: "/lol-lobby/v2/lobby",
    });
  }

  /** 创建 5v5 自定义训练房（PRACTICETOOL，召唤师峡谷）。lobbyPassword 字段必须始终存在（无密码传空串）；顶层 queueId 为 3100 */
  create5v5PracticeLobby(options: CreatePracticeLobbyOptions): Promise<unknown> {
    return this.transport.request<unknown>({
      method: "POST",
      path: "/lol-lobby/v2/lobby",
      json: {
        queueId: options.queueId ?? 3100,
        customGameLobby: {
          configuration: {
            gameMode: "PRACTICETOOL",
            gameMutator: "",
            gameServerRegion: "",
            mapId: options.mapId ?? 11,
            mutators: { id: 1 },
            spectatorPolicy: "AllAllowed",
            teamSize: 5,
          },
          lobbyName: options.name,
          lobbyPassword: options.password ?? "",
        },
        isCustom: true,
      },
    });
  }

  /** 再来一局 */
  playAgain(): Promise<void> {
    return this.transport.request<void>({
      method: "POST",
      path: "/lol-lobby/v2/play-again",
    });
  }
}
