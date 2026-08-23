/**
 * BOOTH 链接 / 商品 ID 解析。
 * 支持形态:
 *   - https://booth.pm/ja/items/12345        (ja/en/zh-cn/zh-tw 等任意语言前缀)
 *   - https://booth.pm/items/12345           (无语言前缀)
 *   - 纯数字字符串 "12345"
 */
import { BoothError } from "../errors.js";

/** 解析结果。 */
export interface ParsedBoothInput {
  /** 商品 ID(数字字符串)。 */
  itemId: string;
}

/** 从任意段提取商品 ID;非 booth 链接返回 null。 */
export function extractItemIdFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "booth.pm" && !parsed.hostname.endsWith(".booth.pm")) {
    return null;
  }
  const segments = parsed.pathname.split("/").filter((s) => s !== "");
  // 期望 .../items/<id>;允许 /<lang>/items/<id>。
  const itemsIndex = segments.lastIndexOf("items");
  if (itemsIndex === -1) {
    return null;
  }
  const idSegment = segments[itemsIndex + 1];
  if (idSegment === undefined || !/^\d+$/.test(idSegment)) {
    return null;
  }
  return idSegment;
}

/** 解析输入:booth 链接或纯数字 ID → item id。非法输入抛 INVALID_URL。 */
export function parseBoothInput(input: string): ParsedBoothInput {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new BoothError("INVALID_URL", "empty input");
  }
  if (/^\d+$/.test(trimmed)) {
    return { itemId: trimmed };
  }
  const itemId = extractItemIdFromUrl(trimmed);
  if (itemId === null) {
    throw new BoothError("INVALID_URL", `cannot parse as booth item link or id: ${input}`);
  }
  return { itemId };
}

/** 判断输入是否 booth 链接。 */
export function isBoothUrl(input: string): boolean {
  return extractItemIdFromUrl(input.trim()) !== null;
}

/** 规范化商品 ID(去前导零)。 */
export function normalizeItemId(id: string): string {
  return String(Number(id));
}
