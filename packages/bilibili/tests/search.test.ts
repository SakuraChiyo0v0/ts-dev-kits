import { afterEach, describe, expect, it } from "vitest";
import { createBilibiliClient } from "../src/index.js";
import { startMockApi, type MockApi } from "./helpers/mock-api.js";

let mock: MockApi | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

/** 与 client-auth.test.ts 一致的 WBI nav mock（供 WbiSigner 获取 img/sub key）。 */
const NAV_ROUTE = {
  "/x/web-interface/nav": () => ({
    wbi_img: {
      img_url: "https://i0.hdslb.com/bfs/wbi/7cd0849410c1a048bf5d4e47a4e1e1c9.png",
      sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
    },
  }),
};

describe("SearchApi", () => {
  it("按关键词搜索视频并映射字段", async () => {
    mock = await startMockApi({
      ...NAV_ROUTE,
      "/x/web-interface/wbi/search/type": () => ({
        result: [
          {
            type: "video",
            bvid: "BV1xx411c7mD",
            aid: 170001,
            title: "测试视频 <em class=\"keyword\">标题</em>",
            pic: "https://example.com/cover.jpg",
            duration: "1:02:03",
            play: 123456,
            danmaku: 789,
            pubdate: 1700000000,
            author: "测试UP主",
            mid: 10086,
            arcurl: "https://www.bilibili.com/video/BV1xx411c7mD",
          },
          {
            type: "video",
            bvid: "BV1yy411c7mE",
            aid: 170002,
            title: "另一个视频",
            duration: "5:30",
          },
        ],
      }),
    });

    const client = createBilibiliClient({ baseUrl: mock.url, cookie: "SESSDATA=abc" });
    const videos = await client.search.searchVideos("测试", { pageSize: 20 });

    expect(videos).toHaveLength(2);
    expect(videos[0]).toMatchObject({
      bvid: "BV1xx411c7mD",
      aid: 170001,
      title: "测试视频 标题", // <em> 标签被剥离
      cover: "https://example.com/cover.jpg",
      duration: 3723, // 1:02:03
      play: 123456,
      danmaku: 789,
      pubdate: 1700000000,
      author: "测试UP主",
      mid: 10086,
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
    });
    expect(videos[1]).toMatchObject({
      bvid: "BV1yy411c7mE",
      duration: 330, // 5:30
    });
  });

  it("空结果返回空数组", async () => {
    mock = await startMockApi({
      ...NAV_ROUTE,
      "/x/web-interface/wbi/search/type": () => ({ result: null }),
    });
    const client = createBilibiliClient({ baseUrl: mock.url, cookie: "SESSDATA=abc" });
    const videos = await client.search.searchVideos("无结果");
    expect(videos).toEqual([]);
  });
});

describe("SearchApi popular", () => {
  it("获取综合热门视频", async () => {
    mock = await startMockApi({
      "/x/web-interface/popular": () => ({
        list: [
          {
            bvid: "BV1zz411c7mF",
            aid: 170003,
            title: "热门视频",
            pic: "https://example.com/popular.jpg",
            duration: 240,
            owner: { mid: 10087, name: "热门UP主" },
            stat: { view: 999999, danmaku: 5555 },
            pubdate: 1700000001,
          },
        ],
        no_more: false,
      }),
    });
    const client = createBilibiliClient({ baseUrl: mock.url, cookie: "SESSDATA=abc" });
    const videos = await client.search.popularVideos({ ps: 20 });

    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      bvid: "BV1zz411c7mF",
      aid: 170003,
      title: "热门视频",
      cover: "https://example.com/popular.jpg",
      duration: 240,
      play: 999999,
      danmaku: 5555,
      author: "热门UP主",
      mid: 10087,
      url: "https://www.bilibili.com/video/BV1zz411c7mF",
    });
  });
});

describe("SearchApi recommendFeed", () => {
  it("拉取首页推荐流并过滤非视频条目、返回续拉游标", async () => {
    mock = await startMockApi({
      ...NAV_ROUTE,
      "/x/web-interface/wbi/index/top/feed/rcmd": () => ({
        item: [
          {
            goto: "av",
            aid: 170004,
            bvid: "BV1aa411c7mG",
            title: "推荐视频A",
            pic: "https://example.com/rcmd-a.jpg",
            duration: 300,
            owner: { mid: 10088, name: "推荐UP主" },
            stat: { view: 12345, danmaku: 67 },
            rcmd_reason: { reason_type: 2, content: "热门" },
          },
          { goto: "live", id: 999, title: "直播混入项" }, // 应被过滤
          {
            goto: "av",
            aid: 170005,
            bvid: "BV1bb411c7mH",
            title: "推荐视频B",
            duration: 180,
          },
        ],
        idx: 42,
        idx_1h: 7,
      }),
    });
    const client = createBilibiliClient({ baseUrl: mock.url, cookie: "SESSDATA=abc" });
    const page = await client.search.recommendFeed({ ps: 20 });

    expect(page.items).toHaveLength(2);
    expect(page.freshIdx).toBe(42);
    expect(page.freshIdx1h).toBe(7);
    expect(page.items[0]).toMatchObject({
      bvid: "BV1aa411c7mG",
      aid: 170004,
      title: "推荐视频A",
      cover: "https://example.com/rcmd-a.jpg",
      duration: 300,
      play: 12345,
      danmaku: 67,
      author: "推荐UP主",
      mid: 10088,
    });
  });
});

describe("SearchApi ranking / weekly", () => {
  it("获取全站排行榜", async () => {
    mock = await startMockApi({
      "/x/web-interface/ranking/v2": () => ({
        list: [
          {
            aid: 170006,
            bvid: "BV1cc411c7mI",
            title: "榜一视频",
            pic: "https://example.com/rank1.jpg",
            duration: 420,
            owner: { mid: 10089, name: "榜一UP主" },
            stat: { view: 888888, danmaku: 6666 },
            pts: 999,
          },
        ],
      }),
    });
    const client = createBilibiliClient({ baseUrl: mock.url, cookie: "SESSDATA=abc" });
    const videos = await client.search.ranking({ rid: 0 });

    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      bvid: "BV1cc411c7mI",
      title: "榜一视频",
      play: 888888,
      author: "榜一UP主",
    });
  });

  it("每周必看：期数列表 + 单期内容", async () => {
    mock = await startMockApi({
      "/x/web-interface/popular/series/list": () => ({
        list: [
          { number: 257, title: "第257期 高质量二创", cover: "https://example.com/weekly257.jpg" },
          { number: 256, title: "第256期 科技前沿", cover: "https://example.com/weekly256.jpg" },
        ],
      }),
      "/x/web-interface/popular/series/one": () => ({
        list: [
          {
            aid: 170007,
            bvid: "BV1dd411c7mJ",
            title: "周榜视频",
            pic: "https://example.com/weekly-video.jpg",
            duration: 200,
            owner: { mid: 10090, name: "周榜UP主" },
            stat: { view: 4321, danmaku: 98 },
          },
        ],
      }),
    });
    const client = createBilibiliClient({ baseUrl: mock.url, cookie: "SESSDATA=abc" });

    const eps = await client.search.weeklyPopularList();
    expect(eps).toHaveLength(2);
    expect(eps[0]).toMatchObject({ number: 257, title: "第257期 高质量二创" });

    const videos = await client.search.weeklyPopularVideos({ number: 257 });
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ bvid: "BV1dd411c7mJ", author: "周榜UP主" });
  });
});
