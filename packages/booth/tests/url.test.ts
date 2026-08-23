import { describe, expect, it } from "vitest";
import {
  parseBoothInput,
  isBoothUrl,
  normalizeItemId,
  extractItemIdFromUrl,
} from "../src/parsers/url.js";
import { BoothError } from "../src/errors.js";

describe("parseBoothInput", () => {
  it("解析 ja 前缀链接", () => {
    expect(parseBoothInput("https://booth.pm/ja/items/12345").itemId).toBe("12345");
  });

  it("解析 en / zh-cn / zh-tw 前缀链接", () => {
    expect(parseBoothInput("https://booth.pm/en/items/999").itemId).toBe("999");
    expect(parseBoothInput("https://booth.pm/zh-cn/items/100").itemId).toBe("100");
    expect(parseBoothInput("https://booth.pm/zh-tw/items/200").itemId).toBe("200");
  });

  it("解析无语言前缀链接", () => {
    expect(parseBoothInput("https://booth.pm/items/42").itemId).toBe("42");
  });

  it("解析带查询串的链接", () => {
    expect(parseBoothInput("https://booth.pm/ja/items/777?ref=home").itemId).toBe("777");
  });

  it("解析纯数字 ID", () => {
    expect(parseBoothInput("12345").itemId).toBe("12345");
    expect(parseBoothInput("  42  ").itemId).toBe("42");
  });

  it("非法输入抛 INVALID_URL", () => {
    for (const bad of ["", "  ", "abc", "https://example.com/ja/items/1", "https://booth.pm/ja/items/abc", "https://booth.pm/shop/foo"]) {
      expect(() => parseBoothInput(bad)).toThrowError(BoothError);
      try {
        parseBoothInput(bad);
        throw new Error("should have thrown");
      } catch (error) {
        expect((error as BoothError).code).toBe("INVALID_URL");
      }
    }
  });
});

describe("extractItemIdFromUrl", () => {
  it("booth.pm 子域名也识别", () => {
    expect(extractItemIdFromUrl("https://shop.booth.pm/ja/items/5")).toBe("5");
  });

  it("非 booth 域名返回 null", () => {
    expect(extractItemIdFromUrl("https://pixiv.net/ja/items/1")).toBeNull();
    expect(extractItemIdFromUrl("not a url")).toBeNull();
  });
});

describe("isBoothUrl", () => {
  it("判断是否为 booth 链接", () => {
    expect(isBoothUrl("https://booth.pm/ja/items/1")).toBe(true);
    expect(isBoothUrl("12345")).toBe(false);
  });
});

describe("normalizeItemId", () => {
  it("去除前导零", () => {
    expect(normalizeItemId("00123")).toBe("123");
  });
});
