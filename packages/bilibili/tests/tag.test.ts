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

describe("TagApi queries", () => {
  it("lists tags", async () => {
    const m = await startMock({
      "/x/relation/tags": () => [
        { tagid: 0, name: "默认分组", count: 10 },
        { tagid: -10, name: "特别关注", count: 3 },
        { tagid: 123, name: "朋友", count: 5 },
      ],
    });
    const { client } = await makeClient();
    const tags = await client.tag.listTags();

    expect(tags).toHaveLength(3);
    expect(tags[0]).toMatchObject({ tagid: 0, name: "默认分组", count: 10 });
    expect(tags[1]).toMatchObject({ tagid: -10, name: "特别关注", count: 3 });
  });

  it("lists tag users", async () => {
    const m = await startMock({
      "/x/relation/tag": () => [
        { mid: 1, uname: "a", face: "f", sign: "s" },
        { mid: 2, uname: "b" },
      ],
    });
    const { client } = await makeClient();
    const users = await client.tag.listTagUsers(123, { pn: 1, ps: 10 });

    expect(users[0]).toMatchObject({ mid: 1, uname: "a", face: "f", sign: "s", attribute: 0 });
    expect(users[1]).toMatchObject({ mid: 2, uname: "b" });
    const req = m.requests.find((r) => r.path.includes("/x/relation/tag?"));
    expect(req?.path).toContain("tagid=123");
    expect(req?.path).toContain("pn=1");
    expect(req?.path).toContain("ps=10");
  });

  it("gets user tags map", async () => {
    const m = await startMock({
      "/x/relation/tag/user": () => ({ 123: "朋友", 456: "同事" }),
    });
    const { client } = await makeClient();
    const map = await client.tag.getUserTags(14082);

    expect(map.size).toBe(2);
    expect(map.get(123)).toBe("朋友");
    expect(map.get(456)).toBe("同事");
    const req = m.requests.find((r) => r.path.includes("/x/relation/tag/user"));
    expect(req?.path).toContain("fid=14082");
  });

  it("lists special mids", async () => {
    const m = await startMock({ "/x/relation/tag/special": () => [1, 2, 3] });
    const { client } = await makeClient();
    expect(await client.tag.listSpecialMids()).toEqual([1, 2, 3]);
  });
});

describe("TagApi management", () => {
  it("creates a tag and returns tagid", async () => {
    const m = await startMock({ "/x/relation/tag/create": () => ({ tagid: 216677 }) });
    const { client } = await makeClient();
    const tagid = await client.tag.createTag("测试");

    expect(tagid).toBe(216677);
    const req = m.requests.find((r) => r.path.includes("/x/relation/tag/create"));
    expect(req?.body).toMatchObject({ tag: "测试", csrf: "csrf123" });
  });

  it("rejects empty tag name", async () => {
    const m = await startMock({ "/x/relation/tag/create": () => ({ tagid: 1 }) });
    const { client } = await makeClient();
    await expect(client.tag.createTag("  ")).rejects.toMatchObject({ code: "API_ERROR" });
  });

  it("throws API_ERROR when tagid missing", async () => {
    const m = await startMock({ "/x/relation/tag/create": () => ({}) });
    const { client } = await makeClient();
    await expect(client.tag.createTag("x")).rejects.toMatchObject({ code: "API_ERROR" });
  });

  it("renames a tag", async () => {
    const m = await startMock({ "/x/relation/tag/update": () => ({}) });
    const { client } = await makeClient();
    await client.tag.renameTag(194112, "膜法师");

    const req = m.requests.find((r) => r.path.includes("/x/relation/tag/update"));
    expect(req?.body).toMatchObject({ tagid: "194112", name: "膜法师", csrf: "csrf123" });
  });

  it("deletes a tag", async () => {
    const m = await startMock({ "/x/relation/tag/del": () => ({}) });
    const { client } = await makeClient();
    await client.tag.deleteTag(216699);

    const req = m.requests.find((r) => r.path.includes("/x/relation/tag/del"));
    expect(req?.body).toMatchObject({ tagid: "216699", csrf: "csrf123" });
  });

  it("adds users to tags", async () => {
    const m = await startMock({ "/x/relation/tags/addUsers": () => ({}) });
    const { client } = await makeClient();
    await client.tag.addUsersToTags([205631797], [-10, 207542]);

    const req = m.requests.find((r) => r.path.includes("/x/relation/tags/addUsers"));
    expect(req?.body).toMatchObject({
      fids: "205631797",
      tagids: "-10,207542",
      csrf: "csrf123",
    });
  });

  it("removes users from tags by moving to default group (tagids=0)", async () => {
    const m = await startMock({ "/x/relation/tags/addUsers": () => ({}) });
    const { client } = await makeClient();
    await client.tag.removeUsersFromTags([205631797]);

    const req = m.requests.find((r) => r.path.includes("/x/relation/tags/addUsers"));
    expect(req?.body).toMatchObject({ fids: "205631797", tagids: "0" });
  });

  it("copies users to tags", async () => {
    const m = await startMock({ "/x/relation/tags/copyUsers": () => ({}) });
    const { client } = await makeClient();
    await client.tag.copyUsersToTags([4856007, 326499679], [231305]);

    const req = m.requests.find((r) => r.path.includes("/x/relation/tags/copyUsers"));
    expect(req?.body).toMatchObject({
      fids: "4856007,326499679",
      tagids: "231305",
      csrf: "csrf123",
    });
  });

  it("moves users between tags", async () => {
    const m = await startMock({ "/x/relation/tags/moveUsers": () => ({}) });
    const { client } = await makeClient();
    await client.tag.moveUsersToTags([321173469, 327086920], [207542], [231305]);

    const req = m.requests.find((r) => r.path.includes("/x/relation/tags/moveUsers"));
    expect(req?.body).toMatchObject({
      fids: "321173469,327086920",
      beforeTagids: "207542",
      afterTagids: "231305",
      csrf: "csrf123",
    });
  });

  it("rejects empty input for ops", async () => {
    const m = await startMock({ "/x/relation/tags/addUsers": () => ({}) });
    const { client } = await makeClient();
    await expect(client.tag.addUsersToTags([], [1])).rejects.toMatchObject({ code: "API_ERROR" });
  });

  it("throws LOGIN_REQUIRED without bili_jct", async () => {
    const m = await startMock({ "/x/relation/tag/create": () => ({ tagid: 1 }) });
    const client = createBilibiliClient({ baseUrl: m.url, cookie: "SESSDATA=abc" });
    await expect(client.tag.createTag("x")).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  });
});
