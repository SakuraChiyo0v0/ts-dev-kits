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

describe("FavApi folder management", () => {
  it("creates a folder with csrf and returns id", async () => {
    const m = await startMock({
      "/x/v3/fav/folder/add": () => ({ id: 1182306172 }),
    });
    const { client } = await makeClient();

    const id = await client.fav.createFolder({
      title: "test",
      intro: "2333",
      privacy: 1,
    });

    expect(id).toBe(1182306172);
    const req = m.requests.find((r) => r.path.includes("/x/v3/fav/folder/add"));
    expect(req?.method).toBe("POST");
    expect(req?.body).toMatchObject({
      title: "test",
      intro: "2333",
      privacy: "1",
      csrf: "csrf123",
    });
  });

  it("creates a default public folder without optional fields", async () => {
    const m = await startMock({ "/x/v3/fav/folder/add": () => ({ id: 1 }) });
    const { client } = await makeClient();
    await client.fav.createFolder({ title: "plain" });

    const req = m.requests.find((r) => r.path.includes("/x/v3/fav/folder/add"));
    expect(req?.body).toEqual({ title: "plain", csrf: "csrf123" });
  });

  it("rejects empty title", async () => {
    const m = await startMock({ "/x/v3/fav/folder/add": () => ({ id: 1 }) });
    const { client } = await makeClient();
    await expect(client.fav.createFolder({ title: "  " })).rejects.toMatchObject({
      code: "API_ERROR",
    });
  });

  it("throws API_ERROR when response missing id", async () => {
    const m = await startMock({ "/x/v3/fav/folder/add": () => ({}) });
    const { client } = await makeClient();
    await expect(client.fav.createFolder({ title: "x" })).rejects.toMatchObject({
      code: "API_ERROR",
    });
  });

  it("edits a folder", async () => {
    const m = await startMock({ "/x/v3/fav/folder/edit": () => ({}) });
    const { client } = await makeClient();
    await client.fav.editFolder(1182306172, { title: "new", privacy: 0 });

    const req = m.requests.find((r) => r.path.includes("/x/v3/fav/folder/edit"));
    expect(req?.body).toMatchObject({
      media_id: "1182306172",
      title: "new",
      privacy: "0",
      csrf: "csrf123",
    });
  });

  it("deletes folders with comma-separated ids", async () => {
    const m = await startMock({ "/x/v3/fav/folder/del": () => ({}) });
    const { client } = await makeClient();
    await client.fav.deleteFolder([1, 2, 3]);

    const req = m.requests.find((r) => r.path.includes("/x/v3/fav/folder/del"));
    expect(req?.body).toMatchObject({ media_ids: "1,2,3", csrf: "csrf123" });
  });

  it("throws LOGIN_REQUIRED when no bili_jct cookie for writes", async () => {
    const m = await startMock({ "/x/v3/fav/folder/add": () => ({ id: 1 }) });
    const client = createBilibiliClient({
      baseUrl: m.url,
      cookie: "SESSDATA=abc",
    });
    await expect(client.fav.createFolder({ title: "x" })).rejects.toMatchObject({
      code: "LOGIN_REQUIRED",
    });
  });
});

describe("FavApi content operations", () => {
  it("adds video to folders via deal API", async () => {
    const m = await startMock({ "/x/v3/fav/resource/deal": () => ({}) });
    const { client } = await makeClient();
    await client.fav.addVideo(170001, [1182306172, 1182306173]);

    const req = m.requests.find((r) => r.path.includes("/x/v3/fav/resource/deal"));
    expect(req?.method).toBe("POST");
    expect(req?.body).toMatchObject({
      rid: "170001",
      type: "2",
      add_media_ids: "1182306172,1182306173",
      platform: "web",
      csrf: "csrf123",
    });
    expect(req?.headers.referer).toBe("https://www.bilibili.com/");
  });

  it("removes video via deal API with del_media_ids", async () => {
    const m = await startMock({ "/x/v3/fav/resource/deal": () => ({}) });
    const { client } = await makeClient();
    await client.fav.removeVideo(170001, [1182306172]);

    const req = m.requests.find((r) => r.path.includes("/x/v3/fav/resource/deal"));
    expect(req?.body).toMatchObject({
      rid: "170001",
      type: "2",
      del_media_ids: "1182306172",
    });
    expect(req?.body?.add_media_ids).toBeUndefined();
  });

  it("checks whether a video is favoured", async () => {
    const m = await startMock({
      "/x/web-interface/view": () => ({ aid: 170001 }),
      "/x/v2/fav/video/favoured": () => ({ favoured: true }),
    });
    const { client } = await makeClient();
    const favoured = await client.fav.isFavoured("BV1xx411c7mD");

    expect(favoured).toBe(true);
    const viewReq = m.requests.find((r) => r.path.includes("/x/web-interface/view"));
    expect(viewReq?.path).toContain("bvid=BV1xx411c7mD");
    const req = m.requests.find((r) => r.path.includes("/x/v2/fav/video/favoured"));
    expect(req?.path).toContain("aid=170001");
  });

  it("checks favoured state with plain aid without view call", async () => {
    const m = await startMock({ "/x/v2/fav/video/favoured": () => ({ favoured: false }) });
    const { client } = await makeClient();
    const favoured = await client.fav.isFavoured(170001);

    expect(favoured).toBe(false);
    expect(m.requests.some((r) => r.path.includes("/x/web-interface/view"))).toBe(false);
  });

  it("copies resources with mid from cookie and encoded resources", async () => {
    const m = await startMock({ "/x/v3/fav/resource/copy": () => ({}) });
    const { client } = await makeClient();
    await client.fav.copyResources(1, 2, [
      { type: 2, id: 170001 },
      { type: 12, id: 42 },
    ]);

    const req = m.requests.find((r) => r.path.includes("/x/v3/fav/resource/copy"));
    expect(req?.body).toMatchObject({
      src_media_id: "1",
      tar_media_id: "2",
      mid: "10086",
      resources: "170001:2,42:12",
      platform: "web",
      csrf: "csrf123",
    });
  });

  it("moves resources", async () => {
    const m = await startMock({ "/x/v3/fav/resource/move": () => ({}) });
    const { client } = await makeClient();
    await client.fav.moveResources(1, 2, [{ type: 2, id: 170001 }]);

    const req = m.requests.find((r) => r.path.includes("/x/v3/fav/resource/move"));
    expect(req?.body).toMatchObject({
      src_media_id: "1",
      tar_media_id: "2",
      mid: "10086",
      resources: "170001:2",
    });
  });

  it("throws LOGIN_REQUIRED when DedeUserID missing for copy", async () => {
    const m = await startMock({ "/x/v3/fav/resource/copy": () => ({}) });
    const client = createBilibiliClient({
      baseUrl: m.url,
      cookie: "SESSDATA=abc; bili_jct=csrf123",
    });
    await expect(
      client.fav.copyResources(1, 2, [{ type: 2, id: 170001 }]),
    ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  });

  it("batch removes resources", async () => {
    const m = await startMock({ "/x/v3/fav/resource/batch-del": () => ({}) });
    const { client } = await makeClient();
    await client.fav.batchRemove(1182306172, [
      { type: 2, id: 170001 },
      { type: 21, id: 99 },
    ]);

    const req = m.requests.find((r) => r.path.includes("/x/v3/fav/resource/batch-del"));
    expect(req?.body).toMatchObject({
      media_id: "1182306172",
      resources: "170001:2,99:21",
      platform: "web",
      csrf: "csrf123",
    });
  });

  it("cleans invalid resources", async () => {
    const m = await startMock({ "/x/v3/fav/resource/clean": () => ({}) });
    const { client } = await makeClient();
    await client.fav.cleanInvalid(1182306172);

    const req = m.requests.find((r) => r.path.includes("/x/v3/fav/resource/clean"));
    expect(req?.body).toMatchObject({ media_id: "1182306172", csrf: "csrf123" });
  });
});

describe("FavApi queries", () => {
  it("gets folder info", async () => {
    const m = await startMock({
      "/x/v3/fav/folder/info": () => ({
        id: 1182306172,
        fid: 1234,
        mid: 10086,
        title: "我的收藏",
        media_count: 42,
        attr: 1,
        intro: "简介",
        ctime: 1700000000,
      }),
    });
    const { client } = await makeClient();
    const info = await client.fav.getFolderInfo(1182306172);

    expect(info).toMatchObject({
      id: 1182306172,
      fid: 1234,
      mid: 10086,
      title: "我的收藏",
      mediaCount: 42,
      privacy: true,
      isDefault: false,
      intro: "简介",
      ctime: 1700000000,
    });
  });

  it("lists created folders (attr bit1 = default folder)", async () => {
    const m = await startMock({
      "/x/v3/fav/folder/created/list-all": () => ({
        count: 2,
        list: [
          { id: 1, fid: 1, mid: 10086, title: "默认", media_count: 3, attr: 2 },
          { id: 2, fid: 2, mid: 10086, title: "公开", media_count: 5, attr: 0 },
        ],
      }),
    });
    const { client } = await makeClient();
    const folders = await client.fav.listCreatedFolders(10086, { type: 2 });

    expect(folders).toHaveLength(2);
    expect(folders[0]).toMatchObject({ title: "默认", isDefault: true, privacy: false });
    expect(folders[1]).toMatchObject({ title: "公开", isDefault: false, privacy: false });
    const req = m.requests.find((r) => r.path.includes("/x/v3/fav/folder/created/list-all"));
    expect(req?.path).toContain("up_mid=10086");
    expect(req?.path).toContain("type=2");
  });

  it("lists collected folders", async () => {
    const m = await startMock({
      "/x/v3/fav/folder/collected/list": () => ({
        list: [{ id: 9, fid: 9, mid: 1, title: "别人家", media_count: 7, attr: 0 }],
      }),
    });
    const { client } = await makeClient();
    const folders = await client.fav.listCollectedFolders(10086);

    expect(folders).toHaveLength(1);
    expect(folders[0]?.title).toBe("别人家");
    const req = m.requests.find((r) => r.path.includes("/x/v3/fav/folder/collected/list"));
    expect(req?.path).toContain("up_mid=10086");
    expect(req?.path).toContain("platform=web");
  });

  it("lists resources with paging and maps upper", async () => {
    const m = await startMock({
      "/x/v3/fav/resource/list": () => ({
        has_more: true,
        info: { id: 1182306172, fid: 1234, mid: 10086, title: "收藏", media_count: 1, attr: 0 },
        medias: [
          {
            id: 170001,
            bvid: "BV1xx411c7mD",
            title: "测试视频",
            pic: "https://example.com/cover.jpg",
            duration: 120,
            upper: { mid: 1000, name: "up" },
          },
        ],
      }),
    });
    const { client } = await makeClient();
    const page = await client.fav.listResources(1182306172, { pn: 2, ps: 10 });

    expect(page.hasMore).toBe(true);
    expect(page.info?.title).toBe("收藏");
    expect(page.list[0]).toMatchObject({
      id: 170001,
      bvid: "BV1xx411c7mD",
      title: "测试视频",
      cover: "https://example.com/cover.jpg",
      duration: 120,
      upper: { mid: 1000, name: "up" },
    });
    const req = m.requests.find((r) => r.path.includes("/x/v3/fav/resource/list"));
    expect(req?.path).toContain("media_id=1182306172");
    expect(req?.path).toContain("pn=2");
    expect(req?.path).toContain("ps=10");
  });
});
