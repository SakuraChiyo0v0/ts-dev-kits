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
    }),
    "/pgc/view/web/season": () => ({
      result: {
        season_id: 30001,
        title: "测试番剧",
        episodes: [
          { id: 500001, aid: 111, bvid: "BV1aa", cid: 220001, title: "第一集", long_title: "第1集 初见", duration: 1200 },
          { id: 500002, aid: 111, bvid: "BV1aa", cid: 220002, title: "第二集", long_title: "第2集 重逢", duration: 1200 },
        ],
      },
    }),
    "/pugv/view/web/season": () => ({
      result: {
        ep_id: 600001,
        aid: 222,
        bvid: "BV1bb",
        cid: 230001,
        title: "测试课程",
        season: { season_id: 40001, title: "课程系列" },
      },
    }),
    "/audio/music-service-c/web/song/info": () => ({
      id: 700001,
      title: "测试歌曲",
      duration: 240,
    }),
    "/x/space/wbi/arc/search": () => ({
      list: {
        vlist: [
          {
            bvid: "BV1cc",
            aid: 333,
            title: "空间视频1",
            pic: "https://example.com/1.jpg",
            length: "05:30",
            play: 10000,
            comment: 30,
            typeid: 1,
            created: 1700000000,
            description: "简介1",
            is_charging_arc: true,
          },
          {
            bvid: "BV1dd",
            aid: 444,
            title: "空间视频2",
            pic: "https://example.com/2.jpg",
            length: "01:02:03",
            play: 5000,
            typeid: 2,
            created: 1690000000,
          },
        ],
      },
    }),
    "/x/v3/fav/resource/list": () => ({
      medias: [
        { id: 1, bvid: "BV1ee", title: "收藏视频", cover: "https://example.com/c.jpg", duration: 300 },
      ],
    }),
    "/x/web-interface/popular/series/one": () => ({
      list: [
        { bvid: "BV1ff", aid: 555, title: "每周必看视频", pic: "https://example.com/w.jpg", duration: 180 },
      ],
    }),
  });
  return createBilibiliClient({ baseUrl: mock!.url });
}

describe("v2 parsers", () => {
  it("parses bangumi episodes", async () => {
    const client = await startMock();
    const items = await client.parse("https://www.bilibili.com/bangumi/play/ep500001");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: "bangumi",
      epId: 500001,
      seasonId: 30001,
      cid: 220001,
      title: "第1集 初见",
    });
  });

  it("parses cheese course", async () => {
    const client = await startMock();
    const items = await client.parse("https://www.bilibili.com/cheese/play/ep600001");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "cheese",
      epId: 600001,
      seasonId: 40001,
      bvid: "BV1bb",
      cid: 230001,
    });
  });

  it("parses audio song", async () => {
    const client = await startMock();
    const items = await client.parse("https://www.bilibili.com/audio/au700001");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "audio", sid: 700001, title: "测试歌曲" });
  });

  it("parses UP space videos", async () => {
    const client = await startMock();
    const items = await client.parse("https://space.bilibili.com/1000");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: "video",
      bvid: "BV1cc",
      play: 10000,
      comment: 30,
      pubdate: 1700000000,
      tid: 1,
      description: "简介1",
      chargingArc: true,
    });
    // 时长解析 05:30 → 330 秒
    expect(items[0]?.duration).toBe(330);
    // 01:02:03 → 3723 秒
    expect(items[1]?.duration).toBe(3723);
    // 未提供的字段不填充
    expect(items[1]?.comment).toBeUndefined();
    expect(items[1]?.chargingArc).toBeUndefined();
  });

  it("passes list options to space arc/search", async () => {
    const client = await startMock();
    await client.parse("https://space.bilibili.com/1000", { pn: 2, ps: 10, order: "click", tid: 3 });
    const req = mock!.requests.find((r) => r.path.startsWith("/x/space/wbi/arc/search"));
    expect(req).toBeDefined();
    const query = new URLSearchParams(req!.path.split("?")[1] ?? "");
    expect(query.get("mid")).toBe("1000");
    expect(query.get("pn")).toBe("2");
    expect(query.get("ps")).toBe("10");
    expect(query.get("order")).toBe("click");
    expect(query.get("tid")).toBe("3");
    // 默认值兜底
    await client.parse("https://space.bilibili.com/1000");
    const req2 = mock!.requests.filter((r) => r.path.startsWith("/x/space/wbi/arc/search"))[1];
    const query2 = new URLSearchParams(req2!.path.split("?")[1] ?? "");
    expect(query2.get("pn")).toBe("1");
    expect(query2.get("ps")).toBe("40");
    expect(query2.get("order")).toBe("pubdate");
  });

  it("parses favlist videos", async () => {
    const client = await startMock();
    const items = await client.parse("https://www.bilibili.com/medialist/detail/ml123?fid=1");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "video", bvid: "BV1ee", title: "收藏视频" });
  });

  it("parses popular weekly videos", async () => {
    const client = await startMock();
    const items = await client.parse("https://www.bilibili.com/v/popular/series/one?num=200");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "video", bvid: "BV1ff" });
  });
});
