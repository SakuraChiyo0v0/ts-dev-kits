import { describe, expect, it } from "vitest";
import { isNeteaseUrl, parseNeteaseUrl } from "../src/parsers/url.js";

describe("parseNeteaseUrl", () => {
  it("parses /song?id=123", () => {
    expect(parseNeteaseUrl("https://music.163.com/song?id=123")).toEqual({ type: "song", id: "123" });
  });

  it("parses /song/123 path form", () => {
    expect(parseNeteaseUrl("https://music.163.com/song/456")).toEqual({ type: "song", id: "456" });
  });

  it("parses /playlist?id=789", () => {
    expect(parseNeteaseUrl("https://music.163.com/playlist?id=789")).toEqual({
      type: "playlist",
      id: "789",
    });
  });

  it("parses /album?id=111", () => {
    expect(parseNeteaseUrl("https://music.163.com/album?id=111")).toEqual({ type: "album", id: "111" });
  });

  it("parses hash-routed /#/song?id=222", () => {
    expect(parseNeteaseUrl("https://music.163.com/#/song?id=222")).toEqual({ type: "song", id: "222" });
  });

  it("rejects non-netease hosts", () => {
    expect(() => parseNeteaseUrl("https://example.com/song?id=1")).toThrowError(
      expect.objectContaining({ code: "INVALID_URL" }),
    );
  });

  it("rejects malformed input", () => {
    expect(() => parseNeteaseUrl("not a url")).toThrowError(
      expect.objectContaining({ code: "INVALID_URL" }),
    );
  });

  it("rejects missing id", () => {
    expect(() => parseNeteaseUrl("https://music.163.com/song")).toThrowError(
      expect.objectContaining({ code: "INVALID_URL" }),
    );
  });
});

describe("isNeteaseUrl", () => {
  it("detects netease hosts", () => {
    expect(isNeteaseUrl("https://music.163.com/song?id=1")).toBe(true);
    expect(isNeteaseUrl("https://163cn.tv/abc")).toBe(true);
    expect(isNeteaseUrl("https://example.com")).toBe(false);
  });
});
