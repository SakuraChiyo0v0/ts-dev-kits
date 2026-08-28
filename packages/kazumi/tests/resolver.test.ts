/**
 * 播放页取流解析器测试 —— 直出 m3u8 / video 标签 / iframe 递归 / 纯 JS 失败。
 */
import { describe, expect, it } from "vitest";
import {
  PlaybackResolver,
  extractIframeUrl,
  extractM3u8Url,
} from "../src/stream/resolver.js";
import { KazumiError } from "../src/errors.js";

/** 伪造 fetch:按 URL 返回预设响应。 */
function mockFetch(routes: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    for (const [key, body] of Object.entries(routes)) {
      if (url.includes(key)) {
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

const HEADERS: Record<string, string> = { "user-agent": "test" };

describe("extractM3u8Url", () => {
  it("提取直出 m3u8", () => {
    const html = '<html><body><script>var url="https://cdn.example.com/video.m3u8?token=1";</script></body></html>';
    expect(extractM3u8Url(html)).toBe("https://cdn.example.com/video.m3u8?token=1");
  });

  it("无 m3u8 返回 null", () => {
    expect(extractM3u8Url("<html><body>no video</body></html>")).toBeNull();
  });
});

describe("extractIframeUrl", () => {
  it("提取 iframe src", () => {
    const html = '<iframe src="https://player.example.com/vip/?url=abc"></iframe>';
    expect(extractIframeUrl(html)).toBe("https://player.example.com/vip/?url=abc");
  });
});

describe("PlaybackResolver", () => {
  it("m3u8 直链直接返回", async () => {
    const resolver = new PlaybackResolver(mockFetch({}));
    const result = await resolver.resolve(
      "https://cdn.example.com/video.m3u8",
      HEADERS,
      5000,
    );
    expect(result.url).toBe("https://cdn.example.com/video.m3u8");
    expect(result.viaIframe).toBe(false);
  });

  it("播放页直出 m3u8 → 解析成功", async () => {
    const resolver = new PlaybackResolver(
      mockFetch({
        "example.com/play/1": '<html><body><script>var src="https://cdn.x.com/a.m3u8";</script></body></html>',
      }),
    );
    const result = await resolver.resolve("https://example.com/play/1", HEADERS, 5000);
    expect(result.url).toBe("https://cdn.x.com/a.m3u8");
  });

  it("video 标签 src 相对路径 → 补全为绝对 URL", async () => {
    const resolver = new PlaybackResolver(
      mockFetch({
        "example.com/play/1": '<html><body><video src="/media/v.m3u8"></video></body></html>',
      }),
    );
    const result = await resolver.resolve("https://example.com/play/1", HEADERS, 5000);
    expect(result.url).toBe("https://example.com/media/v.m3u8");
  });

  it("iframe 递归:播放页 → iframe 解析站 → m3u8", async () => {
    const resolver = new PlaybackResolver(
      mockFetch({
        "example.com/play/1": '<html><body><iframe src="https://jx.example.com/vip/?url=abc"></iframe></body></html>',
        "jx.example.com/vip": '<html><body><script>var u="https://cdn.jx.com/final.m3u8";</script></body></html>',
      }),
    );
    const result = await resolver.resolve("https://example.com/play/1", HEADERS, 5000);
    expect(result.url).toBe("https://cdn.jx.com/final.m3u8");
    expect(result.viaIframe).toBe(true);
    expect(result.path).toHaveLength(2);
  });

  it("纯 JS 动态取流(无静态 m3u8/iframe) → 明确错误", async () => {
    const resolver = new PlaybackResolver(
      mockFetch({
        "example.com/play/1": '<html><body><script>var a_src=""; $.ajax({url:"/api"});</script></body></html>',
      }),
    );
    await expect(
      resolver.resolve("https://example.com/play/1", HEADERS, 5000),
    ).rejects.toMatchObject({ code: "STREAM_PARSE_FAILED" });
  });

  it("iframe 深度超限 → 明确错误", async () => {
    const resolver = new PlaybackResolver(
      mockFetch({
        "a.com/1": '<iframe src="https://b.com/2"></iframe>',
        "b.com/2": '<iframe src="https://c.com/3"></iframe>',
        "c.com/3": '<iframe src="https://d.com/4"></iframe>',
        "d.com/4": '<iframe src="https://e.com/5"></iframe>',
      }),
      2,
    );
    await expect(
      resolver.resolve("https://a.com/1", HEADERS, 5000),
    ).rejects.toThrow(KazumiError);
  });
});
