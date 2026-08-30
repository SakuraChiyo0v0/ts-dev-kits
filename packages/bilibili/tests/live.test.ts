import { afterEach, describe, expect, it } from "vitest";
import { createBilibiliClient } from "../src/index.js";
import { startMockApi, type MockApi } from "./helpers/mock-api.js";

let mock: MockApi | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe("LiveApi", () => {
  it("拉取关注直播列表并映射字段", async () => {
    mock = await startMockApi({
      "/xlive/web-ucenter/user/following": () => ({
        list: [
          {
            roomid: 23000,
            live_status: 1,
            title: "今晚播点什么",
            cover: "https://example.com/live.jpg",
            owner: { mid: 10091, name: "主播A" },
            record_live_time: 1700000000,
          },
          {
            roomid: 23001,
            live_status: 0,
            title: "上次直播回放",
            cover: "https://example.com/live2.jpg",
            owner: { mid: 10092, name: "主播B" },
            record_live_time: 1690000000,
          },
        ],
        live_count: 1,
        totalPage: 3,
      }),
    });
    const client = createBilibiliClient({ baseUrl: mock.url, liveBaseUrl: mock.url, cookie: "SESSDATA=abc;DedeUserID=10086" });
    const page = await client.live.following({ page: 1 });

    expect(page.rooms).toHaveLength(2);
    expect(page.liveCount).toBe(1);
    expect(page.totalPage).toBe(3);
    expect(page.rooms[0]).toMatchObject({
      roomid: 23000,
      liveStatus: 1,
      title: "今晚播点什么",
      cover: "https://example.com/live.jpg",
      upName: "主播A",
      upMid: 10091,
      liveTime: 1700000000,
    });
    expect(page.rooms[1]?.liveStatus).toBe(0);
  });
});

describe("SearchApi likedVideos", () => {
  it("拉取点赞过的视频（archive 嵌套解包）", async () => {
    mock = await startMockApi({
      "/x/v2/space/likearc": () => ({
        count: 2,
        list: [
          {
            archive: {
              aid: 170008,
              bvid: "BV1ee411c7mK",
              title: "点赞视频A",
              pic: "https://example.com/liked-a.jpg",
              duration: 260,
              owner: { mid: 10093, name: "点赞UP主" },
              stat: { view: 11111, danmaku: 222 },
            },
          },
          { archive: null }, // 失效条目应被过滤
          {
            archive: {
              aid: 170009,
              bvid: "BV1ff411c7mL",
              title: "点赞视频B",
              duration: 90,
            },
          },
        ],
      }),
    });
    const client = createBilibiliClient({ baseUrl: mock.url, cookie: "SESSDATA=abc;DedeUserID=10086" });
    const { items, count } = await client.search.likedVideos();

    expect(count).toBe(2);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      bvid: "BV1ee411c7mK",
      title: "点赞视频A",
      author: "点赞UP主",
      play: 11111,
    });
  });

  it("未登录（无 DedeUserID）返回空", async () => {
    mock = await startMockApi({});
    const client = createBilibiliClient({ baseUrl: mock.url, cookie: "SESSDATA=abc" });
    const { items, count } = await client.search.likedVideos();
    expect(items).toEqual([]);
    expect(count).toBe(0);
  });
});
