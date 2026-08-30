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
