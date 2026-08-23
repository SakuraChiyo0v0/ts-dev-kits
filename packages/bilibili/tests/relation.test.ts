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
  const client = createBilibiliClient({ baseUrl: m.url, cookie: COOKIE });
  return { client, mock: m };
}

describe("RelationApi modify", () => {
  it("follows a user with act=1 and re_src", async () => {
    const m = await startMock({ "/x/relation/modify": () => ({}) });
    const { client } = await makeClient();
    await client.relation.follow(14082);

    const req = m.requests.find((r) => r.path.includes("/x/relation/modify"));
    expect(req?.method).toBe("POST");
    expect(req?.body).toMatchObject({
      fid: "14082",
      act: "1",
      re_src: "11",
      csrf: "csrf123",
    });
  });

  it("unfollows a user with act=2", async () => {
    const m = await startMock({ "/x/relation/modify": () => ({}) });
    const { client } = await makeClient();
    await client.relation.unfollow(14082);

    const req = m.requests.find((r) => r.path.includes("/x/relation/modify"));
    expect(req?.body).toMatchObject({ fid: "14082", act: "2" });
  });

  it("blocks and unblocks", async () => {
    const m = await startMock({ "/x/relation/modify": () => ({}) });
    const { client } = await makeClient();
    await client.relation.block(14082);
    await client.relation.unblock(14082);

    const acts = m.requests
      .filter((r) => r.path.includes("/x/relation/modify"))
      .map((r) => r.body?.act);
    expect(acts).toEqual(["5", "6"]);
  });

  it("batch follows and returns failed fids", async () => {
    const m = await startMock({
      "/x/relation/batch/modify": () => ({ failed_fids: [2] }),
    });
    const { client } = await makeClient();
    const failed = await client.relation.batchFollow([1, 2, 3]);

    expect(failed).toEqual([2]);
    const req = m.requests.find((r) => r.path.includes("/x/relation/batch/modify"));
    expect(req?.body).toMatchObject({ fids: "1,2,3", act: "1", re_src: "11" });
  });

  it("batch block returns [] for empty input", async () => {
    const m = await startMock({ "/x/relation/batch/modify": () => ({}) });
    const { client } = await makeClient();
    expect(await client.relation.batchBlock([])).toEqual([]);
    expect(m.requests.length).toBe(0);
  });

  it("throws LOGIN_REQUIRED without bili_jct", async () => {
    const m = await startMock({ "/x/relation/modify": () => ({}) });
    const client = createBilibiliClient({ baseUrl: m.url, cookie: "SESSDATA=abc" });
    await expect(client.relation.follow(1)).rejects.toMatchObject({
      code: "LOGIN_REQUIRED",
    });
  });
});

describe("RelationApi queries", () => {
  it("lists followings with paging", async () => {
    const m = await startMock({
      "/x/relation/followings": () => ({
        total: 2,
        list: [
          { mid: 1, attribute: 2, uname: "a", face: "f1", mtime: 100 },
          { mid: 2, attribute: 6, uname: "b", tag: [1, 2], special: 0 },
        ],
      }),
    });
    const { client } = await makeClient();
    const page = await client.relation.listFollowings(10086, { pn: 1, ps: 10 });

    expect(page.total).toBe(2);
    expect(page.list[0]).toMatchObject({ mid: 1, attribute: 2, uname: "a", face: "f1", mtime: 100 });
    expect(page.list[1]).toMatchObject({ mid: 2, attribute: 6, tag: [1, 2], special: 0 });
    const req = m.requests.find((r) => r.path.includes("/x/relation/followings"));
    expect(req?.path).toContain("vmid=10086");
    expect(req?.path).toContain("pn=1");
    expect(req?.path).toContain("ps=10");
  });

  it("passes order_type when provided", async () => {
    const m = await startMock({ "/x/relation/followings": () => ({ total: 0, list: [] }) });
    const { client } = await makeClient();
    await client.relation.listFollowings(10086, { orderType: "attention" });

    const req = m.requests.find((r) => r.path.includes("/x/relation/followings"));
    expect(req?.path).toContain("order_type=attention");
  });

  it("lists followers", async () => {
    const m = await startMock({
      "/x/relation/followers": () => ({
        total: 1,
        list: [{ mid: 7, attribute: 0, uname: "fan" }],
      }),
    });
    const { client } = await makeClient();
    const page = await client.relation.listFollowers(10086);

    expect(page.list[0]).toMatchObject({ mid: 7, uname: "fan", attribute: 0 });
  });

  it("gets relation stat", async () => {
    const m = await startMock({
      "/x/relation/stat": () => ({ following: 100, whisper: 1, black: 2, follower: 200 }),
    });
    const { client } = await makeClient();
    const stat = await client.relation.getStat(10086);

    expect(stat).toEqual({ following: 100, whisper: 1, black: 2, follower: 200 });
  });

  it("gets relation pair with wbi-signed request", async () => {
    const m = await startMock({
      "/x/web-interface/nav": () => ({
        wbi_img: {
          img_url: "https://i0.hdslb.com/bfs/wbi/7cd0849410c1a048bf5d4e47a4e1e1c9.png",
          sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
        },
      }),
      "/x/space/wbi/acc/relation": () => ({
        relation: { mid: 14082, attribute: 2, uname: "up" },
        be_relation: { mid: 10086, attribute: 6, uname: "me" },
      }),
    });
    const { client } = await makeClient();
    const pair = await client.relation.getRelation(14082);

    expect(pair.relation).toMatchObject({ mid: 14082, attribute: 2, uname: "up" });
    expect(pair.beRelation).toMatchObject({ mid: 10086, attribute: 6, uname: "me" });
    const req = m.requests.find((r) => r.path.startsWith("/x/space/wbi/acc/relation"));
    expect(req).toBeDefined();
    expect(req!.path).toContain("w_rid=");
    expect(req!.path).toContain("mid=14082");
  });

  it("batch queries relations into a map", async () => {
    const m = await startMock({
      "/x/relation/relations": () => ({
        1: { mid: 1, attribute: 2, uname: "a" },
        2: { mid: 2, attribute: 0, uname: "b" },
      }),
    });
    const { client } = await makeClient();
    const map = await client.relation.getRelations([1, 2]);

    expect(map.size).toBe(2);
    expect(map.get(1)).toMatchObject({ attribute: 2, uname: "a" });
    expect(map.get(2)).toMatchObject({ attribute: 0, uname: "b" });
  });

  it("lists blacks with ps cap at 50", async () => {
    const m = await startMock({
      "/x/relation/blacks": () => ({ total: 1, list: [{ mid: 9, attribute: 128, uname: "x" }] }),
    });
    const { client } = await makeClient();
    const page = await client.relation.listBlacks({ ps: 200 });

    expect(page.total).toBe(1);
    expect(page.list[0]).toMatchObject({ mid: 9, attribute: 128 });
    const req = m.requests.find((r) => r.path.includes("/x/relation/blacks"));
    expect(req?.path).toContain("ps=50");
  });

  it("lists friends", async () => {
    const m = await startMock({
      "/x/relation/friends": () => ({ list: [{ mid: 3, attribute: 6, uname: "friend" }] }),
    });
    const { client } = await makeClient();
    const friends = await client.relation.listFriends();

    expect(friends[0]).toMatchObject({ mid: 3, uname: "friend", attribute: 6 });
  });

  it("lists same followings", async () => {
    const m = await startMock({
      "/x/relation/same/followings": () => ({ total: 1, list: [{ mid: 4, attribute: 2, uname: "same" }] }),
    });
    const { client } = await makeClient();
    const page = await client.relation.listSameFollowings(10086);

    expect(page.list[0]?.uname).toBe("same");
  });

  it("searches followings by name", async () => {
    const m = await startMock({
      "/x/relation/followings/search": () => ({ total: 1, list: [{ mid: 5, attribute: 2, uname: "warma" }] }),
    });
    const { client } = await makeClient();
    const page = await client.relation.searchFollowings(10086, "warma");

    expect(page.list[0]?.uname).toBe("warma");
    const req = m.requests.find((r) => r.path.includes("/x/relation/followings/search"));
    expect(req?.path).toContain("name=warma");
  });

  it("gets followers unread count", async () => {
    const m = await startMock({
      "/x/relation/followers/unread/count": () => ({ count: 5, time: 1700000000 }),
    });
    const { client } = await makeClient();
    const unread = await client.relation.getFollowersUnread();

    expect(unread).toEqual({ count: 5, time: 1700000000 });
  });
});
