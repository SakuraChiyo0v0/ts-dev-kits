/**
 * 领取(claim)与加购。
 * 真实流程(2026-08 实测):
 *   - 免费商品(0 日元,页面含 downloadables 链接):GET /downloadables/<id>?variation_id=<vid>
 *     (带 cookie)→ 302 重定向到 S3 预签名直链,直接下载,不生成订单。
 *   - 付费商品:POST https://<shop>.booth.pm/cart?added_to_cart=true&via=market
 *     字段 cart_item[variation_id]=<vid> + authenticity_token + _method=patch,
 *     加入购物车后由用户在浏览器完成支付。
 *   - 已拥有商品:页面按钮态为已购,跳过。
 */
import { BoothError, checkApiResponse } from "../errors.js";
import type { BoothItem, ClaimResult } from "../types.js";
import type { BoothSession } from "../session.js";

export interface ClaimActionResult {
  kind: "claimed" | "paid-pending" | "skipped";
  downloadUrl?: string;
  payUrl?: string;
}

/** 从 downloadables 302 重定向中提取最终下载 URL(无则回退原 URL)。 */
export function extractRedirectLocation(response: Response): string | undefined {
  return response.headers.get("location") ?? undefined;
}

/** 领取 API。 */
export class ClaimApi {
  readonly #session: BoothSession;

  constructor(session: BoothSession) {
    this.#session = session;
  }

  /**
   * 领取商品:
   *   - 免费 → GET downloadables → 302 → S3 直链,返回 claimed + downloadUrl;
   *   - 付费 → POST 店铺 cart → 加购,返回 paid-pending + payUrl(购物车页);
   *   - 已拥有 → skipped。
   */
  async claim(item: BoothItem): Promise<ClaimActionResult> {
    if (item.alreadyOwned) {
      return { kind: "skipped" };
    }
    if (item.priceYen === 0 || item.downloadUrl !== undefined) {
      return this.#claimFree(item);
    }
    return this.#addToCart(item);
  }

  /** 免费商品:GET downloadables(302 → S3 直链)。 */
  async #claimFree(item: BoothItem): Promise<ClaimActionResult> {
    if (item.downloadUrl === undefined) {
      throw new BoothError("API_ERROR", "free item has no downloadables url", { itemId: item.id });
    }
    const url = item.downloadUrl.startsWith("http")
      ? item.downloadUrl
      : `${this.#session.baseUrl}${item.downloadUrl}`;
    // 手动重定向:先拿 302 Location(S3 直链),再跟随下载。
    const response = await this.#session.request(url, { method: "GET", redirect: "manual" });
    const location = extractRedirectLocation(response);
    if (location !== undefined && /^https?:\/\//i.test(location)) {
      return { kind: "claimed", downloadUrl: location };
    }
    // 无重定向(直接 200):视为可直接下载的响应体。
    if (response.status === 200) {
      return { kind: "claimed", downloadUrl: url };
    }
    // 非 2xx/无重定向:按状态归类。
    checkApiResponse(response, { itemId: item.id });
    throw new BoothError("API_ERROR", "unexpected downloadables response", { itemId: item.id });
  }

  /** 付费商品:POST 店铺 cart 加购。 */
  async #addToCart(item: BoothItem): Promise<ClaimActionResult> {
    if (item.variationId === undefined) {
      throw new BoothError("API_ERROR", "paid item has no variation id", { itemId: item.id });
    }
    // 加购端点:真实 BOOTH 为 https://<shop>.booth.pm/cart;
    // 自定义 baseUrl(测试/mock 环境)时用 baseUrl 上的 /cart 路由。
    const base = this.#session.baseUrl;
    const isRealBooth = /(^|\.)booth\.pm$/i.test(new URL(base).hostname);
    const shopCartUrl = isRealBooth
      ? `https://${item.shopId}.booth.pm/cart?added_to_cart=true&via=market`
      : `${base}/cart?added_to_cart=true&via=market`;
    const body = new URLSearchParams({
      _method: "patch",
      "cart_item[variation_id]": item.variationId,
      authenticity_token: item.csrfToken,
    });
    const response = await this.#session.request(shopCartUrl, {
      method: "POST",
      body: body.toString(),
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-Token": item.csrfToken,
      },
    });
    // 加购成功通常 302 → 购物车页或 200;失败按状态归类。
    if (response.status >= 300 && response.status < 400) {
      const location = extractRedirectLocation(response);
      return {
        kind: "paid-pending",
        ...(location !== undefined ? { payUrl: location } : { payUrl: "https://booth.pm/carts" }),
      };
    }
    if (response.status === 200) {
      return { kind: "paid-pending", payUrl: "https://booth.pm/carts" };
    }
    // 403:常为 Cloudflare 人机验证拦截(自动化环境)。降级为返回购物车 URL,
    // 由用户浏览器手动加购/支付,而非 SDK 报错。
    if (response.status === 403) {
      return { kind: "paid-pending", payUrl: "https://booth.pm/carts" };
    }
    if (response.status === 404) {
      throw new BoothError("NOT_FOUND", "cart endpoint not found (shop may be invalid)", {
        itemId: item.id,
      });
    }
    if (response.status === 401) {
      throw new BoothError("LOGIN_REQUIRED", "session required to add to cart", { itemId: item.id });
    }
    checkApiResponse(response, { itemId: item.id });
    throw new BoothError("API_ERROR", "unexpected add-to-cart response", { itemId: item.id });
  }
}

/** 便捷:把 ClaimActionResult 映射为 ClaimResult。 */
export function toClaimResult(input: string, itemId: string, result: ClaimActionResult): ClaimResult {
  switch (result.kind) {
    case "claimed":
      return {
        input,
        itemId,
        status: "claimed",
        ...(result.downloadUrl !== undefined ? { downloadUrl: result.downloadUrl } : {}),
      };
    case "paid-pending":
      return {
        input,
        itemId,
        status: "paid-pending",
        ...(result.payUrl !== undefined ? { payUrl: result.payUrl } : {}),
      };
    case "skipped":
      return { input, itemId, status: "skipped" };
  }
}
