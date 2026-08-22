/**
 * 事件订阅门面：在传输层 WebSocket 事件之上提供命名订阅。
 * 内置四个核心事件（current-summoner / gameflow-phase / champ-select / entitlements-token），
 * 与 Seraphine 同策略，避免错过早期状态变更。
 */

import type { ChampSelectSession, CurrentSummoner, GameflowPhase, LcuEvent } from "./types.js";
import type { LcuTransport } from "./transport.js";

export const EVENTS = {
  currentSummoner: "OnJsonApiEvent_lol-summoner_v1_current-summoner",
  gameflowPhase: "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase",
  champSelect: "OnJsonApiEvent_lol-champ-select_v1_session",
  entitlementsToken: "OnJsonApiEvent_entitlements_v1_token",
} as const;

export const EVENT_URIS = {
  currentSummoner: "/lol-summoner/v1/current-summoner",
  gameflowPhase: "/lol-gameflow/v1/gameflow-phase",
  champSelect: "/lol-champ-select/v1/session",
  entitlementsToken: "/entitlements/v1/token",
} as const;

export class EventBus {
  constructor(private readonly transport: LcuTransport) {}

  /** 通用订阅：eventName 形如 OnJsonApiEvent_lol-gameflow_v1_gameflow-phase */
  subscribe(eventName: string, handler: (event: LcuEvent) => void): () => void {
    return this.transport.subscribe(eventName, handler);
  }

  /** 对局状态变更（Lobby / Matchmaking / ReadyCheck / ChampSelect / InGame …） */
  onGameflowPhase(handler: (phase: GameflowPhase, event: LcuEvent) => void): () => void {
    return this.subscribeFiltered(EVENTS.gameflowPhase, EVENT_URIS.gameflowPhase, (event) => {
      handler(event.data as GameflowPhase, event);
    });
  }

  /** 选人会话变更 */
  onChampSelect(handler: (session: ChampSelectSession, event: LcuEvent) => void): () => void {
    return this.subscribeFiltered(EVENTS.champSelect, EVENT_URIS.champSelect, (event) => {
      handler(event.data as ChampSelectSession, event);
    });
  }

  /** 当前召唤师信息变更 */
  onCurrentSummoner(handler: (summoner: CurrentSummoner, event: LcuEvent) => void): () => void {
    return this.subscribeFiltered(EVENTS.currentSummoner, EVENT_URIS.currentSummoner, (event) => {
      handler(event.data as CurrentSummoner, event);
    });
  }

  /** SGP access token 刷新（国服） */
  onSgpToken(handler: (token: string, event: LcuEvent) => void): () => void {
    return this.subscribeFiltered(EVENTS.entitlementsToken, EVENT_URIS.entitlementsToken, (event) => {
      const data = event.data as { accessToken?: string } | null;
      if (data?.accessToken) {
        handler(data.accessToken, event);
      }
    });
  }

  private subscribeFiltered(
    eventName: string,
    uri: string,
    handler: (event: LcuEvent) => void,
  ): () => void {
    return this.transport.subscribe(eventName, (event) => {
      if (event.uri === uri) {
        handler(event);
      }
    });
  }
}
