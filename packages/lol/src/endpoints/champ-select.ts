/**
 * 选人阶段模块（P3）：选/禁英雄、交换/交易、皮肤与符文页。
 *
 * ⚠️ 风险披露：自动操作类接口（pick/ban/acceptTrade 等）属灰色地带，
 * 可能违反 Riot/腾讯规则，不保证不封号，调用方自担风险。
 */

import type { ChampSelectAction, ChampSelectSession } from "../types.js";
import type { LcuTransport } from "../transport.js";

export interface ChampSelectMySelection {
  spell1Id: number;
  spell2Id: number;
  wardSkinId: number;
  selectedSkinId: number;
  [key: string]: unknown;
}

export interface SkinCarouselItem {
  id: number;
  name: string;
  isBase: boolean;
  ownership: { owned: boolean; [key: string]: unknown };
  [key: string]: unknown;
}

export interface RunePage {
  autoModifiedSelections: unknown[];
  current: boolean;
  id: number;
  isActive: boolean;
  isDeletable: boolean;
  isEditable: boolean;
  isTemporary: boolean;
  isValid: boolean;
  lastModified: number;
  name: string;
  order: number;
  primaryStyleId: number;
  selectedPerkIds: number[];
  subStyleId: number;
  [key: string]: unknown;
}

export interface CreateRunePageOptions {
  name: string;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: number[];
}

export class ChampSelectApi {
  constructor(private readonly transport: LcuTransport) {}

  /** 选人会话（队友/对手/行动列表/计时器） */
  getSession(): Promise<ChampSelectSession> {
    return this.transport.request<ChampSelectSession>({
      method: "GET",
      path: "/lol-champ-select/v1/session",
    });
  }

  /** 我的选人状态（已选皮肤/召唤师技能） */
  getMySelection(): Promise<ChampSelectMySelection> {
    return this.transport.request<ChampSelectMySelection>({
      method: "GET",
      path: "/lol-champ-select/v1/session/my-selection",
    });
  }

  /** 当前选择的英雄 */
  getCurrentChampion(): Promise<{ championId: number; [key: string]: unknown }> {
    return this.transport.request<{ championId: number; [key: string]: unknown }>({
      method: "GET",
      path: "/lol-champ-select/v1/current-champion",
    });
  }

  /** 选择英雄（completed=true 时锁定） */
  pick(actionId: number, championId: number, completed = false): Promise<void> {
    return this.transport.request<void>({
      method: "PATCH",
      path: `/lol-champ-select/v1/session/actions/${actionId}`,
      json: { championId, type: "pick", ...(completed ? { completed: true } : {}) },
    });
  }

  /** 禁用英雄（completed=true 时锁定禁用） */
  ban(actionId: number, championId: number, completed = false): Promise<void> {
    return this.transport.request<void>({
      method: "PATCH",
      path: `/lol-champ-select/v1/session/actions/${actionId}`,
      json: { championId, type: "ban", ...(completed ? { completed: true } : {}) },
    });
  }

  /** 完成一个行动（锁定） */
  completeAction(actionId: number): Promise<void> {
    return this.transport.request<void>({
      method: "PATCH",
      path: `/lol-champ-select/v1/session/actions/${actionId}`,
      json: { completed: true },
    });
  }

  /** 同意队友的英雄交换请求 */
  async acceptTrade(tradeId: number): Promise<void> {
    await this.transport.request<void>({
      method: "POST",
      path: `/lol-champ-select/v1/session/trades/${tradeId}/accept`,
    });
    await this.transport.request<void>({
      method: "POST",
      path: `/lol-champ-select/v1/ongoing-trade/${tradeId}/clear`,
    });
  }

  /** 同意队友的楼层交换请求 */
  async acceptSwap(swapId: number): Promise<void> {
    await this.transport.request<void>({
      method: "POST",
      path: `/lol-champ-select/v1/session/swaps/${swapId}/accept`,
    });
    await this.transport.request<void>({
      method: "POST",
      path: `/lol-champ-select/v1/ongoing-swap/${swapId}/clear`,
    });
  }

  /** 备战席交换（大乱斗/竞技场） */
  benchSwap(championId: number): Promise<void> {
    return this.transport.request<void>({
      method: "POST",
      path: `/lol-champ-select/v1/session/bench/swap/${championId}`,
    });
  }

  /** 摇骰子 */
  reroll(): Promise<void> {
    return this.transport.request<void>({
      method: "POST",
      path: "/lol-champ-select/v1/session/my-selection/reroll",
    });
  }

  /** 皮肤轮盘（我可用的皮肤） */
  getSkinCarousel(): Promise<SkinCarouselItem[]> {
    return this.transport.request<SkinCarouselItem[]>({
      method: "GET",
      path: "/lol-champ-select/v1/skin-carousel-skins",
    });
  }

  /** 选皮肤/召唤师技能/眼皮肤 */
  selectConfig(options: {
    skinId: number;
    spell1Id?: number;
    spell2Id?: number;
    wardSkinId?: number;
  }): Promise<void> {
    return this.transport.request<void>({
      method: "PATCH",
      path: "/lol-champ-select/v1/session/my-selection",
      json: {
        selectedSkinId: options.skinId,
        ...(options.spell1Id !== undefined ? { spell1Id: options.spell1Id } : {}),
        ...(options.spell2Id !== undefined ? { spell2Id: options.spell2Id } : {}),
        ...(options.wardSkinId !== undefined ? { wardSkinId: options.wardSkinId } : {}),
      },
    });
  }

  /** 当前符文页 */
  getCurrentRunePage(): Promise<RunePage> {
    return this.transport.request<RunePage>({
      method: "GET",
      path: "/lol-perks/v1/currentpage",
    });
  }

  /** 创建符文页（current=true 自动启用） */
  createRunePage(options: CreateRunePageOptions): Promise<RunePage> {
    return this.transport.request<RunePage>({
      method: "POST",
      path: "/lol-perks/v1/pages",
      json: {
        name: options.name,
        primaryStyleId: options.primaryStyleId,
        subStyleId: options.subStyleId,
        selectedPerkIds: options.selectedPerkIds,
        current: true,
      },
    });
  }

  /** 删除符文页 */
  deleteRunePage(pageId: number): Promise<void> {
    return this.transport.request<void>({
      method: "DELETE",
      path: `/lol-perks/v1/pages/${pageId}`,
    });
  }
}

export type { ChampSelectAction };
