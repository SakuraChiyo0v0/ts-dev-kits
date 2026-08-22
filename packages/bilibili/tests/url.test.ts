import { describe, expect, it } from "vitest";
import { parseCookieString } from "@sakurachiyo0v0/bilibili-auth";
import { parseUrl } from "../src/index.js";

describe("parseUrl", () => {
  it("parses BV video URL", () => {
    const result = parseUrl("https://www.bilibili.com/video/BV1xx411c7mD");
    expect(result.type).toBe("video");
    expect(result.id).toBe("BV1xx411c7mD");
  });

  it("parses av video URL", () => {
    const result = parseUrl("https://www.bilibili.com/video/av170001");
    expect(result.type).toBe("video");
    expect(result.id).toBe("170001");
  });

  it("parses page number", () => {
    const result = parseUrl("https://www.bilibili.com/video/BV1xx411c7mD?p=2");
    expect(result.type).toBe("video");
    expect(result.page).toBe(2);
  });

  it("parses bangumi ep", () => {
    const result = parseUrl("https://www.bilibili.com/bangumi/play/ep123456");
    expect(result.type).toBe("bangumi");
    expect(result.id).toBe("123456");
  });

  it("parses space URL", () => {
    const result = parseUrl("https://space.bilibili.com/123456");
    expect(result.type).toBe("space");
    expect(result.id).toBe("123456");
  });

  it("rejects non-bilibili URL", () => {
    expect(() => parseUrl("https://example.com/video")).toThrow(/Not a bilibili URL/);
  });
});

describe("parseCookieString", () => {
  it("parses cookie string into object", () => {
    const result = parseCookieString("SESSDATA=abc; bili_jct=def; DedeUserID=123");
    expect(result).toEqual({
      SESSDATA: "abc",
      bili_jct: "def",
      DedeUserID: "123",
    });
  });
});
