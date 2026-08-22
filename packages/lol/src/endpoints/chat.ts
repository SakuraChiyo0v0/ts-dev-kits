/**
 * 聊天/社交模块（P4）：个人信息、状态签名、会话、好友、客户端通知。
 */

import type { LcuTransport } from "../transport.js";

export type Availability = "chat" | "away" | "dnd" | "mobile" | "offline";

export interface ChatMe {
  availability: Availability;
  gameName: string;
  gameTag: string;
  id: string;
  lastOnline: string;
  lol: {
    bannerIdSelected: number;
    challengeCrystalLevel: number;
    challengePoints: number;
    challengeTokensSelected: string[];
    championId: number;
    companionId: number;
    damagePerMinute: number;
    gameId: number;
    gameMode: string;
    gameName: string;
    iconOverride: string;
    isObserver: boolean;
    level: number;
    mapId: number;
    masteryScore: number;
    profileIconId: number;
    puuid: string;
    queue: string;
    rankedLeagueDivision: string;
    rankedLeagueQueue: string;
    rankedLeagueTier: string;
    rankedRegaliaLevel: number;
    regaliaBannerType: string;
    regaliaCrestType: string;
    skinVariant: string;
    skinVariantOverlay: string;
    [key: string]: unknown;
  };
  name: string;
  pid: string;
  platformId: string;
  product: string;
  productName: string;
  puuid: string;
  statusMessage: string;
  summary: string;
  time: number;
  [key: string]: unknown;
}

export interface Conversation {
  id: string;
  type: string;
  unreadCount: number;
  lastMessage?: { body: string; timestamp: string; [key: string]: unknown };
  [key: string]: unknown;
}

export class ChatApi {
  constructor(private readonly transport: LcuTransport) {}

  /** 我的社交信息（含状态、段位展示字段） */
  getMe(): Promise<ChatMe> {
    return this.transport.request<ChatMe>({
      method: "GET",
      path: "/lol-chat/v1/me",
    });
  }

  /** 修改在线状态/签名 */
  setStatus(message: string): Promise<void> {
    return this.transport.request<void>({
      method: "PUT",
      path: "/lol-chat/v1/me",
      json: { statusMessage: message },
    });
  }

  /** 修改可用性（在线/离开/勿扰） */
  setAvailability(availability: Availability): Promise<void> {
    return this.transport.request<void>({
      method: "PUT",
      path: "/lol-chat/v1/me",
      json: { availability },
    });
  }

  /** 会话列表（私聊/组队频道） */
  getConversations(): Promise<Conversation[]> {
    return this.transport.request<Conversation[]>({
      method: "GET",
      path: "/lol-chat/v1/conversations",
    });
  }

  /** 发送消息 */
  sendMessage(conversationId: string, body: string): Promise<void> {
    return this.transport.request<void>({
      method: "POST",
      path: `/lol-chat/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
      json: { body },
    });
  }

  /** 发送好友申请 */
  sendFriendRequest(name: string): Promise<void> {
    return this.transport.request<void>({
      method: "POST",
      path: "/lol-chat/v1/friend-requests",
      json: { name },
    });
  }

  /** 客户端内通知（toast） */
  sendNotification(options: { title: string; content: string }): Promise<void> {
    return this.transport.request<void>({
      method: "POST",
      path: "/player-notifications/v1/notifications",
      json: {
        critical: true,
        data: {
          details: options.content,
          title: options.title,
        },
        detailKey: "pre_translated_details",
        dismissible: true,
        id: 0,
        state: "toast",
        titleKey: "pre_translated_title",
        type: "ranked_summary",
      },
    });
  }
}
