import { afterEach, describe, expect, it } from "vitest";
import { createBilibiliClient } from "../src/index.js";
import { startMockApi, type MockApi } from "./helpers/mock-api.js";

let mock: MockApi | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

async function startMock() {
  mock = await startMockApi({
    "/x/web-interface/nav": () => ({
      wbi_img: {
        img_url: "https://i0.hdslb.com/bfs/wbi/7cd0849410c1a048bf5d4e47a4e1e1c9.png",
        sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
      },
      isLogin: false,
    }),
    "/x/web-interface/wbi/view": () => ({
      bvid: "BV1xx411c7mD",
      aid: 170001,
      cid: 280001,
      title: "测试视频",
      pic: "https://example.com/cover.jpg",
      duration: 120,
      desc: "desc",
      owner: { mid: 1000, name: "up" },
      pages: [
        { cid: 280001, page: 1, part: "P1", duration: 60 },
        { cid: 280002, page: 2, part: "P2", duration: 60 },
      ],
    }),
    "/x/player/wbi/playurl": () => ({
      quality: 80,
      timelength: 60000,
      accept_quality: [80, 64],
      dash: {
        video: [
          { id: 80, codecid: 7, baseUrl: "https://cdn.example.com/video80.mp4", bandwidth: 1000000, frameRate: "30" },
          { id: 64, codecid: 7, baseUrl: "https://cdn.example.com/video64.mp4", bandwidth: 500000, frameRate: "30" },
        ],
        audio: [
          { id: 30216, baseUrl: "https://cdn.example.com/audio.m4s", bandwidth: 320000 },
        ],
      },
    }),
  });
  return createBilibiliClient({ baseUrl: mock!.url });
}

describe("BilibiliClient parse", () => {
  it("parses video info into pages", async () => {
    const client = await startMock();
    const items = await client.parse("https://www.bilibili.com/video/BV1xx411c7mD");

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: "video",
      bvid: "BV1xx411c7mD",
      cid: 280001,
      title: "测试视频",
    });
    expect(items[1]?.cid).toBe(280002);
  });

  it("includes wbi signature in requests", async () => {
    const client = await startMock();
    await client.parse("https://www.bilibili.com/video/BV1xx411c7mD");

    const viewRequest = mock!.requests.find((r) => r.path.includes("/x/web-interface/wbi/view"));
    expect(viewRequest).toBeDefined();
    expect(viewRequest!.path).toContain("w_rid=");
    expect(viewRequest!.path).toContain("wts=");
    expect(viewRequest!.headers.referer).toBe("https://www.bilibili.com/");
  });

  it("throws UNSUPPORTED_TYPE for unknown content types", async () => {
    const client = await startMock();
    await expect(
      client.parse("https://www.bilibili.com/foo/bar"),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
  });
});

describe("BilibiliClient streams", () => {
  it("gets DASH streams with video and audio", async () => {
    const client = await startMock();
    const items = await client.parse("https://www.bilibili.com/video/BV1xx411c7mD");
    const streams = await client.getStreams(items[0]!, { quality: 80 });

    expect(streams.dash).toBe(true);
    expect(streams.videoStreams.length).toBeGreaterThan(0);
    expect(streams.audioStreams.length).toBeGreaterThan(0);
    expect(streams.videoStreams[0]?.urls.length).toBeGreaterThan(0);
  });

  it("sends qn and fnval params", async () => {
    const client = await startMock();
    const items = await client.parse("https://www.bilibili.com/video/BV1xx411c7mD");
    await client.getStreams(items[0]!, { quality: 80 });

    const playRequest = mock!.requests.find((r) => r.path.includes("/x/player/wbi/playurl"));
    expect(playRequest).toBeDefined();
    expect(playRequest!.path).toContain("qn=80");
    expect(playRequest!.path).toContain("fnval=4048");
  });
});
