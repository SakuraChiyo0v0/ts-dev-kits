import { afterEach, describe, expect, it } from "vitest";
import { createBilibiliClient } from "../src/index.js";
import { startMockApi, type MockApi } from "./helpers/mock-api.js";

const COOKIE = "SESSDATA=abc; bili_jct=csrf123; DedeUserID=10086";

let mock: MockApi | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

async function startMock(routes: Record<string, () => unknown>): Promise<MockApi> {
  const api = await startMockApi(routes);
  mock = api;
  return api;
}

async function makeClient() {
  const m = mock!;
  const client = createBilibiliClient({ baseUrl: m.url, memberBaseUrl: m.url, cookie: COOKIE });
  return { client, mock: m };
}

describe("CreativeApi archives", () => {
  it("lists archives with stats", async () => {
    const m = await startMock({
      "/x2/creative/web/archives/sp": () => ({
        page: { total: 2, size: 10, num: 1 },
        arc_audits: [
          {
            Archive: {
              aid: 170001,
              bvid: "BV1xx411c7mD",
              title: "我的投稿",
              cover: "bfs/cover.jpg",
              desc: "简介",
              state: 0,
              ctime: 1700000000,
            },
            stat: { view: 100, danmaku: 5, reply: 3, favorite: 2, coin: 1, share: 1, like: 50 },
          },
          { Archive: null },
        ],
      }),
    });
    const { client } = await makeClient();
    const result = await client.creative.listArchives({ pn: 1, ps: 10 });

    expect(result.total).toBe(2);
    expect(result.list).toHaveLength(1);
    expect(result.list[0]).toMatchObject({
      aid: 170001,
      bvid: "BV1xx411c7mD",
      title: "我的投稿",
      view: 100,
      like: 50,
      ctime: 1700000000,
    });
    const req = m.requests.find((r) => r.path.includes("/x2/creative/web/archives/sp"));
    expect(req?.path).toContain("pn=1");
    expect(req?.path).toContain("ps=10");
  });

  it("gets archive videos", async () => {
    const m = await startMock({
      "/x/web/archive/videos": () => ({
        archive: { aid: 170001, bvid: "BV1xx411c7mD", title: "t" },
        videos: [
          { cid: 280001, index: 1, title: "P1", duration: 60 },
          { cid: 280002, index: 2, title: "P2", duration: 60 },
        ],
      }),
    });
    const { client } = await makeClient();
    const videos = await client.creative.getArchiveVideos(170001);

    expect(videos).toHaveLength(2);
    expect(videos[0]).toMatchObject({ cid: 280001, index: 1, title: "P1", duration: 60 });
    const req = m.requests.find((r) => r.path.includes("/x/web/archive/videos"));
    expect(req?.path).toContain("aid=170001");
  });
});

describe("CreativeApi season follow", () => {
  it("follows a season", async () => {
    const m = await startMock({ "/pgc/web/follow/add": () => ({}) });
    const { client } = await makeClient();
    await client.creative.followSeason(41410);

    const req = m.requests.find((r) => r.path.includes("/pgc/web/follow/add"));
    expect(req?.body).toMatchObject({ season_id: "41410", csrf: "csrf123" });
  });

  it("unfollows a season", async () => {
    const m = await startMock({ "/pgc/web/follow/del": () => ({}) });
    const { client } = await makeClient();
    await client.creative.unfollowSeason(41410);

    const req = m.requests.find((r) => r.path.includes("/pgc/web/follow/del"));
    expect(req?.body).toMatchObject({ season_id: "41410", csrf: "csrf123" });
  });
});

describe("CreativeApi list followed seasons", () => {
  it("lists followed seasons", async () => {
    await startMock({
      "/pgc/web/follow/list": () => ({
        list: [
          {
            season_id: 41410,
            media_id: 28941,
            title: "某番剧",
            cover: "https://example.com/bangumi.jpg",
            url: "https://www.bilibili.com/bangumi/play/ss41410",
            new_ep: { index_show: "12" },
            total: 24,
            season_type: 1,
            season_type_name: "番剧",
          },
        ],
        total: 1,
      }),
    });
    const { client } = await makeClient();
    const { list, total } = await client.creative.listFollowedSeasons({ ps: 50 });

    expect(total).toBe(1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      seasonId: 41410,
      mediaId: 28941,
      title: "某番剧",
      cover: "https://example.com/bangumi.jpg",
      url: "https://www.bilibili.com/bangumi/play/ss41410",
      newEp: "12",
      total: 24,
      seasonType: 1,
      seasonTypeName: "番剧",
    });
  });
});
