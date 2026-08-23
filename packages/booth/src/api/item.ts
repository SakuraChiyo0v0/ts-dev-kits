/**
 * 商品信息解析 —— GET 商品页,从内嵌 JSON / JSON-LD / HTML 中提取商品信息。
 * 真实结构(2026-08 实测):
 *   - 免费商品:页面含 <a class="btn ... add-cart ..." href="/downloadables/<id>?variation_id=<vid>">
 *   - 付费商品:页面含 <form class="button_to" method="post" action="https://<shop>.booth.pm/cart?added_to_cart=true">
 *              字段 cart_item[variation_id]=<vid> + authenticity_token
 * 页面结构由 BOOTH 前端决定,解析失败统一抛 API_ERROR(提示站点改版需更新 SDK)。
 */
import { BoothError, checkApiResponse } from "../errors.js";
import type { BoothItem, BoothItemDetail, BoothVariation, ItemDetailOptions } from "../types.js";
import type { BoothSession } from "../session.js";
import { fillTemplate } from "./endpoints.js";

const DEFAULT_LANG = "ja";

/** 从 HTML 中提取第一个指定类型的 JSON-LD script 内容。 */
export function extractJsonLd(html: string, type?: string): unknown {
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = match[1]?.trim();
    if (raw === undefined || raw === "") {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (type === undefined) {
        return parsed;
      }
      const candidate = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of candidate) {
        const obj = entry as { "@type"?: unknown };
        if (obj["@type"] === type) {
          return entry;
        }
      }
    } catch {
      // 跳过解析失败的 script,继续找下一个。
    }
  }
  return undefined;
}

/** 从 HTML 中提取 CSRF token(meta 标签优先,回退隐藏 input)。 */
export function extractCsrfToken(html: string): string | undefined {
  const meta = /<meta\b[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i.exec(html);
  if (meta?.[1] !== undefined) {
    return decodeHtmlEntities(meta[1]);
  }
  const input = /<input\b[^>]*name=["']authenticity_token["'][^>]*value=["']([^"']+)["']/i.exec(html);
  if (input?.[1] !== undefined) {
    return decodeHtmlEntities(input[1]);
  }
  const tokenInput = /<input\b[^>]*name=["']_token["'][^>]*value=["']([^"']+)["']/i.exec(html);
  if (tokenInput?.[1] !== undefined) {
    return decodeHtmlEntities(tokenInput[1]);
  }
  return undefined;
}

/** 从 JSON-LD Product 结构中提取价格(日元)。支持 Offer 与 AggregateOffer。 */
export function extractPriceYen(product: Record<string, unknown>): number {
  const offers = product["offers"] as Record<string, unknown> | undefined;
  if (offers === undefined) {
    return 0;
  }
  // AggregateOffer:lowPrice / highPrice(取低价;单一价格时二者相同)。
  const lowPrice = offers["lowPrice"] ?? offers["price"];
  if (lowPrice !== undefined) {
    const parsed = Number(lowPrice);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const highPrice = offers["highPrice"];
  if (highPrice !== undefined) {
    const parsed = Number(highPrice);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const price = offers["price"];
  if (price !== undefined) {
    const parsed = Number(price);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
}

/** 从 JSON-LD Product 结构中提取卖家店铺 ID/名称。BOOTH 用 brand 表示店铺。 */
export function extractSeller(product: Record<string, unknown>): { shopId: string; shopName?: string } {
  const seller = product["seller"] as Record<string, unknown> | undefined;
  if (seller !== undefined) {
    const identifier = typeof seller["identifier"] === "string" ? seller["identifier"] : undefined;
    const name = typeof seller["name"] === "string" ? seller["name"] : undefined;
    const id = identifier ?? name ?? "";
    return {
      shopId: id !== "" ? id : String(seller["name"] ?? "unknown"),
      ...(name !== undefined && name !== "" ? { shopName: name } : {}),
    };
  }
  // BOOTH 真实页面用 brand(名称 + 店铺子域名 URL)表示卖家。
  const brand = product["brand"] as Record<string, unknown> | undefined;
  if (brand !== undefined) {
    const name = typeof brand["name"] === "string" ? brand["name"] : undefined;
    const url = typeof brand["url"] === "string" ? brand["url"] : undefined;
    let shopId = "";
    if (url !== undefined) {
      try {
        // https://<shop>.booth.pm/ → shop
        const hostname = new URL(url).hostname;
        shopId = hostname.replace(/\.booth\.pm$/i, "");
      } catch {
        // 忽略无效 URL。
      }
    }
    if (shopId === "" && name !== undefined) {
      shopId = name;
    }
    return {
      shopId: shopId !== "" ? shopId : "unknown",
      ...(name !== undefined && name !== "" ? { shopName: name } : {}),
    };
  }
  return { shopId: "" };
}

/**
 * 提取免费商品的 downloadables 下载链接(/downloadables/<id>?variation_id=<vid>)。
 * 优先匹配 add-cart 按钮内链接;无则任意 downloadables 链接。
 */
export function extractDownloadUrl(html: string): string | undefined {
  const addCart = /<a\b[^>]*class=["'][^"']*add-cart[^"']*["'][^>]*href=["']([^"']*downloadables[^"']*)["']/i.exec(
    html,
  );
  if (addCart?.[1] !== undefined) {
    return decodeHtmlEntities(addCart[1]);
  }
  const anyLink = /<a\b[^>]*href=["']([^"']*downloadables[^"']*)["']/i.exec(html);
  return anyLink?.[1] !== undefined ? decodeHtmlEntities(anyLink[1]) : undefined;
}

/** 从 downloadables URL 中提取 variation_id。 */
export function extractVariationId(url: string): string | undefined {
  try {
    const parsed = new URL(url, "https://booth.pm");
    const vid = parsed.searchParams.get("variation_id");
    return vid !== null && vid !== "" ? vid : undefined;
  } catch {
    return undefined;
  }
}

/** 从 HTML 中判断是否已拥有(下载按钮态 / 页面标记)。 */
export function extractAlreadyOwned(html: string): boolean {
  return /(購入済み|購入済|purchased|already.?purchased|入手済み)/i.test(html);
}

/**
 * 提取商品简介/正文介绍。
 * 优先 JSON-LD Product.description(可能含换行,是真实正文);
 * 回退 og:description(单行摘要)。
 */
export function extractDescription(html: string): string | undefined {
  const product = extractJsonLd(html, "Product") as Record<string, unknown> | undefined;
  if (product !== undefined) {
    const desc = product["description"];
    if (typeof desc === "string" && desc.trim() !== "") {
      return decodeHtmlEntities(desc.trim());
    }
  }
  const og = /<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i.exec(html);
  if (og?.[1] !== undefined && og[1].trim() !== "") {
    return decodeHtmlEntities(og[1].trim());
  }
  return undefined;
}

/**
 * 提取商品全部购买项(variations)。
 * 真实结构:<ul class="variations"> 内每个 <li class="variation-item">:
 *   <div class="variation-name">名称</div>
 *   <div class="variation-price">¥ 0</div>
 *   免费:<a class="btn add-cart" href="/downloadables/<id>?variation_id=<vid>">
 *   付费:<form action=".../cart?added_to_cart=true"> + cart_item[variation_id]
 * 页面无 variations 区块(单购买项)时,基于整页基础信息合成单个购买项。
 */
export function extractVariations(html: string, fallback: BoothItem): BoothVariation[] {
  const variations: BoothVariation[] = [];
  const ul = /<ul\b[^>]*class=["'][^"']*variations[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i.exec(html);
  if (ul?.[1] !== undefined) {
    const itemPattern = /<li\b[^>]*class=["'][^"']*variation-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
    for (const match of ul[1].matchAll(itemPattern)) {
      const block = match[1] ?? "";
      const name = /<div\b[^>]*class=["'][^"']*variation-name[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(block);
      const price = /<div\b[^>]*class=["'][^"']*variation-price[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(block);
      // 免费:<a href="/downloadables/...?variation_id=...">;付费:<form action=".../cart...">
      const dlLink = /<a\b[^>]*href=["']([^"']*downloadables[^"']*)["']/i.exec(block);
      const cartForm = /<form\b[^>]*action=["']([^"']*cart[^"']*)["']/i.exec(block);
      const vidInput = /<input\b[^>]*name=["']cart_item\[variation_id\][^>]*value=["']([^"']+)["']/i.exec(
        block,
      );
      const nameText = name?.[1] !== undefined ? decodeHtmlEntities(name[1].trim()) : undefined;
      const priceYen = parsePriceText(price?.[1]);
      const downloadUrl =
        dlLink?.[1] !== undefined ? decodeHtmlEntities(dlLink[1]) : undefined;
      const variationId =
        downloadUrl !== undefined ? extractVariationId(downloadUrl) : vidInput?.[1];
      // 购买项名称缺失时,依次兜底:下载链接 title → URL 文件名 → 加购表单 data-product-name。
      let displayName = nameText;
      if (displayName === undefined || displayName === "") {
        const linkTitle = /<a\b[^>]*title=["']([^"']+)["']/i.exec(block);
        if (linkTitle?.[1] !== undefined) {
          displayName = decodeHtmlEntities(linkTitle[1].trim());
        } else if (downloadUrl !== undefined) {
          try {
            const pathname = new URL(downloadUrl, "https://booth.pm").pathname;
            const base = pathname.split("/").filter(Boolean).pop();
            if (base !== undefined && base !== "") {
              displayName = decodeURIComponent(base);
            }
          } catch {
            // 忽略无效 URL。
          }
        } else {
          const productName = /data-product-name=["']([^"']+)["']/i.exec(block);
          if (productName?.[1] !== undefined) {
            displayName = decodeHtmlEntities(productName[1].trim());
          }
        }
      }

      variations.push({
        id: variationId ?? String(variations.length + 1),
        name: displayName ?? `购买项 ${variations.length + 1}`,
        priceYen,
        free: priceYen === 0 || downloadUrl !== undefined,
        ...(downloadUrl !== undefined ? { downloadUrl } : {}),
        ...(variationId !== undefined ? { variationId } : {}),
      });
    }
  }
  // 无 variations 区块:合成单个购买项(免费 → downloadUrl;付费 → 基础 variationId)。
  if (variations.length === 0) {
    const downloadUrl = fallback.downloadUrl;
    const variationId = fallback.variationId;
    variations.push({
      id: variationId ?? "1",
      name: fallback.title,
      priceYen: fallback.priceYen,
      free: fallback.priceYen === 0 || downloadUrl !== undefined,
      ...(downloadUrl !== undefined ? { downloadUrl } : {}),
      ...(variationId !== undefined ? { variationId } : {}),
    });
  }
  return variations;
}

/** 从价格文本("¥ 6,000" / "¥ 0" / "無料")解析日元金额。 */
function parsePriceText(text: string | undefined): number {
  if (text === undefined) {
    return 0;
  }
  const digits = /([\d,]+)/.exec(text);
  if (digits?.[1] !== undefined) {
    const parsed = Number(digits[1].replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return /無料|free|FREE/i.test(text) ? 0 : 0;
}

/**
 * 从商品页 HTML 解析为 BoothItemDetail。
 * 字段按 options 按需提取(默认全部;可关 description / variations 省 token)。
 * description/variations 在类型上始终存在;关闭对应选项时为空字符串/空数组。
 */
export function parseItemDetail(
  html: string,
  itemId: string,
  options: ItemDetailOptions = {},
): BoothItemDetail {
  const base = parseItemPage(html, itemId);
  const description = options.description !== false ? extractDescription(html) : undefined;
  const variations = options.variations !== false ? extractVariations(html, base) : undefined;
  return {
    ...base,
    description: description ?? "",
    variations: variations ?? [],
  };
}

/** 从 HTML meta 提取标题(og:title 回退 <title>)。 */
export function extractTitle(html: string): string | undefined {
  const og = /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html);
  if (og?.[1] !== undefined) {
    return decodeHtmlEntities(og[1]);
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title?.[1] !== undefined) {
    return decodeHtmlEntities(title[1].trim());
  }
  return undefined;
}

/**
 * 从商品页 HTML 解析为 BoothItem。
 * 找不到可用的商品数据 → 抛 API_ERROR(页面结构变化)。
 */
export function parseItemPage(html: string, itemId: string): BoothItem {
  const product = extractJsonLd(html, "Product") as Record<string, unknown> | undefined;
  if (product === undefined) {
    throw new BoothError(
      "API_ERROR",
      "cannot find product data in item page (BOOTH page structure may have changed)",
      { itemId },
    );
  }
  const name = typeof product["name"] === "string" ? product["name"] : undefined;
  const title = name ?? extractTitle(html);
  if (title === undefined || title === "") {
    throw new BoothError("API_ERROR", "cannot extract item title", { itemId });
  }
  const seller = extractSeller(product);
  if (seller.shopId === "") {
    throw new BoothError("API_ERROR", "cannot extract seller info from item page", { itemId });
  }
  const csrfToken = extractCsrfToken(html);
  if (csrfToken === undefined) {
    throw new BoothError("API_ERROR", "cannot extract csrf token from item page", { itemId });
  }

  const priceYen = extractPriceYen(product);
  const downloadUrl = extractDownloadUrl(html);
  const variationId =
    downloadUrl !== undefined
      ? extractVariationId(downloadUrl)
      : extractVariationIdFromCartForm(html);

  return {
    id: itemId,
    title,
    priceYen,
    shopId: seller.shopId,
    ...(seller.shopName !== undefined ? { shopName: seller.shopName } : {}),
    alreadyOwned: extractAlreadyOwned(html),
    ...(downloadUrl !== undefined ? { downloadUrl } : {}),
    ...(variationId !== undefined ? { variationId } : {}),
    csrfToken,
  };
}

/** 从加购表单(付费商品)中提取 variation_id(cart_item[variation_id])。 */
function extractVariationIdFromCartForm(html: string): string | undefined {
  const match = /<input\b[^>]*name=["']cart_item\[variation_id\][^>]*value=["']([^"']+)["']/i.exec(html);
  return match?.[1] !== undefined && match[1] !== "" ? match[1] : undefined;
}

/** 商品 API:拉取并解析商品页。 */
export class ItemApi {
  readonly #session: BoothSession;

  constructor(session: BoothSession) {
    this.#session = session;
  }

  /** GET 商品页并解析。lang 为页面语言前缀(默认 ja)。 */
  async getItem(itemId: string, lang: string = DEFAULT_LANG): Promise<BoothItem> {
    const path = fillTemplate("{lang}/items/{id}", { lang, id: itemId });
    const response = await this.#session.request(`/${path}`, { method: "GET" });
    checkApiResponse(response, { itemId });
    const html = await response.text();
    // 登录页特征(未登录被重定向到登录页)→ LOGIN_REQUIRED。
    if (/accounts\.booth\.pm|accounts\.pixiv\.net/.test(html) && /login/i.test(html.slice(0, 2000))) {
      throw new BoothError("LOGIN_REQUIRED", "session required to view item page", { itemId });
    }
    return parseItemPage(html, itemId);
  }

  /** GET 商品页并解析为详情(简介/正文 + 全部购买项),字段按需提取。 */
  async getItemDetail(
    itemId: string,
    options: ItemDetailOptions = {},
    lang: string = DEFAULT_LANG,
  ): Promise<BoothItemDetail> {
    const path = fillTemplate("{lang}/items/{id}", { lang, id: itemId });
    const response = await this.#session.request(`/${path}`, { method: "GET" });
    checkApiResponse(response, { itemId });
    const html = await response.text();
    if (/accounts\.booth\.pm|accounts\.pixiv\.net/.test(html) && /login/i.test(html.slice(0, 2000))) {
      throw new BoothError("LOGIN_REQUIRED", "session required to view item page", { itemId });
    }
    return parseItemDetail(html, itemId, options);
  }
}

/** 简单 HTML 实体解码(&amp; &lt; &gt; &quot; &#39;)。 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}
