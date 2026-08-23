/**
 * redeem 域 —— 激活码兑换(store 主机,页面协议写操作)。
 * 流程:GET /account/registerkey(302 + Set-Cookie 会话刷新,提取页面 sessionID)
 *       → POST /account/ajaxregisterkey/ { product_key, sessionid } → JSON。
 * 合规:这是全 SDK 唯一写操作(经用户拍板扩展红线);其余能力保持零写。
 */
import { SteamEndpoints } from "../endpoints.js";
import { SteamError } from "../errors.js";
import type { SteamHttpTransport } from "../http.js";
import type { RedeemResult } from "../types.js";

/** ePurchaseResult 结果码 → 中文描述。 */
const PURCHASE_RESULT_MESSAGES: Record<number, string> = {
  0: "兑换成功",
  1: "该游戏已拥有,无需重复兑换",
  2: "兑换失败",
  3: "激活码已过期",
  4: "账单错误",
  5: "凭据无效(兑换失败)",
  6: "账单信息不完整",
  13: "收货地址无效",
  14: "激活码无效(格式错误或不存在)",
  15: "激活码已被使用",
  17: "该激活码有区域限制,当前地区不可兑换",
  18: "账号被锁定,无法兑换",
  19: "该激活码无法在客户端兑换",
  20: "支付方式无效",
};

export class RedeemApi {
  constructor(private readonly transport: SteamHttpTransport) {}

  /** 当前是否持有登录会话(兑换必需)。 */
  get hasSession(): boolean {
    return this.transport.cookie !== undefined;
  }

  /**
   * 兑换激活码(写操作;需登录态)。激活码会被提交到当前登录账号。
   * 失败不抛错,返回 { success:false, result, message } 供上层展示。
   */
  async redeemActivationKey(activationKey: string): Promise<RedeemResult> {
    const key = activationKey.trim();
    if (key === "") {
      throw new SteamError("CONFIGURATION", "激活码不能为空");
    }
    if (this.transport.cookie === undefined) {
      throw new SteamError("LOGIN_REQUIRED", "兑换激活码需要登录态(登录或导入 cookie)");
    }

    // 1. GET 兑换页:302 + Set-Cookie 会话刷新(sessionRefresh),提取页面 sessionID。
    const page = await this.transport.request<string>({
      host: "store",
      path: SteamEndpoints.store.registerKeyPage,
      withCookies: true,
      sessionRefresh: true,
      rawText: true,
      noCache: true,
    });
    const sessionId = page.match(/sessionID\s*=\s*"([^"]+)"/u)?.[1];
    if (sessionId === undefined) {
      throw new SteamError("AUTH_EXPIRED", "无法从兑换页获取会话标识(登录态可能已失效)");
    }

    // 2. POST 提交激活码(同样带会话刷新)。
    const result = await this.transport.request<{
      success?: number;
      purchase_result_details?: number;
      purchase_receipt_info?: {
        line_items?: Array<{ line_item_description?: string }>;
      };
    }>({
      host: "store",
      path: SteamEndpoints.store.registerKeyAjax,
      method: "POST",
      form: { product_key: key, sessionid: sessionId },
      withCookies: true,
      sessionRefresh: true,
      noCache: true,
    });

    if (result.success === 1) {
      const games = (result.purchase_receipt_info?.line_items ?? [])
        .map((item) => item.line_item_description)
        .filter((name): name is string => name !== undefined && name !== "");
      return {
        success: true,
        result: 0,
        message: games.length > 0 ? `兑换成功:${games.join("、")}` : "兑换成功",
        ...(games.length > 0 ? { games } : {}),
      };
    }

    const detail = result.purchase_result_details ?? 2;
    return {
      success: false,
      result: detail,
      message:
        PURCHASE_RESULT_MESSAGES[detail] ??
        `兑换失败(Steam 结果码 ${detail})`,
    };
  }
}
