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

describe("DataApi toview", () => {
  it("lists toview items", async () => {
    const m = await startMock({
      "/x/v2/history/toview": () => ({
        count: 1,
        list: [
          {
            aid: 170001,
            bvid: "BV1xx411c7mD",
            title: "稍后再看",
            pic: "https://example.com/c.jpg",
            duration: 120,
            owner: { mid: 1000, name: "up" },
          },
        ],
      }),
    });
    const { client } = await makeClient();
    const items = await client.data.listToView();

    expect(items[0]).toMatchObject({
      aid: 170001,
      bvid: "BV1xx411c7mD",
      title: "稍后再看",
      duration: 120,
      owner: { mid: 1000, name: "up" },
    });
  });

  it("adds toview with aid", async () => {
    const m = await startMock({ "/x/v2/history/toview/add": () => ({}) });
    const { client } = await makeClient();
    await client.data.addToView(170001);

    const req = m.requests.find((r) => r.path.includes("/x/v2/history/toview/add"));
    expect(req?.body).toMatchObject({ aid: "170001", csrf: "csrf123" });
  });

  it("adds toview with bvid", async () => {
    const m = await startMock({ "/x/v2/history/toview/add": () => ({}) });
    const { client } = await makeClient();
    await client.data.addToView("BV1xx411c7mD");

    const req = m.requests.find((r) => r.path.includes("/x/v2/history/toview/add"));
    expect(req?.body).toMatchObject({ bvid: "BV1xx411c7mD" });
  });

  it("removes toview with viewed flag", async () => {
    const m = await startMock({ "/x/v2/history/toview/del": () => ({}) });
    const { client } = await makeClient();
    await client.data.removeToView(170001, { viewed: true });

    const req = m.requests.find((r) => r.path.includes("/x/v2/history/toview/del"));
    expect(req?.body).toMatchObject({ aid: "170001", viewed: "1", csrf: "csrf123" });
  });

  it("clears toview", async () => {
    const m = await startMock({ "/x/v2/history/toview/clear": () => ({}) });
    const { client } = await makeClient();
    await client.data.clearToView();

    const req = m.requests.find((r) => r.path.includes("/x/v2/history/toview/clear"));
    expect(req?.body).toMatchObject({ csrf: "csrf123" });
  });
});

describe("DataApi history", () => {
  it("lists history with cursor", async () => {
    const m = await startMock({
      "/x/web-interface/history/cursor": () => ({
        cursor: { max: 170001, view_at: 1700000000, business: "archive", ps: 20 },
        list: [
          {
            title: "看过的视频",
            kid: 170001,
            history: { business: "archive" },
            view_at: 1700000000,
            progress: 60,
            duration: 120,
            author_name: "up",
            author_mid: 1000,
          },
        ],
      }),
    });
    const { client } = await makeClient();
    const result = await client.data.listHistory({ ps: 20 });

    expect(result.cursor).toMatchObject({ max: 170001, viewAt: 1700000000, business: "archive" });
    expect(result.list[0]).toMatchObject({
      title: "看过的视频",
      kid: 170001,
      business: "archive",
      viewAt: 1700000000,
      progress: 60,
      duration: 120,
      authorName: "up",
      authorMid: 1000,
    });
    const req = m.requests.find((r) => r.path.includes("/x/web-interface/history/cursor"));
    expect(req?.path).toContain("ps=20");
  });

  it("deletes a history item with kid", async () => {
    const m = await startMock({ "/x/v2/history/delete": () => ({}) });
    const { client } = await makeClient();
    await client.data.delHistory("archive_170001");

    const req = m.requests.find((r) => r.path.includes("/x/v2/history/delete"));
    expect(req?.body).toMatchObject({ kid: "archive_170001", csrf: "csrf123" });
  });

  it("clears history", async () => {
    const m = await startMock({ "/x/v2/history/clear": () => ({}) });
    const { client } = await makeClient();
    await client.data.clearHistory();

    const req = m.requests.find((r) => r.path.includes("/x/v2/history/clear"));
    expect(req?.body).toMatchObject({ csrf: "csrf123" });
  });

  it("sets history enabled/disabled", async () => {
    const m = await startMock({ "/x/v2/history/shadow/set": () => ({}) });
    const { client } = await makeClient();
    await client.data.setHistoryEnabled(false); // 停用
    await client.data.setHistoryEnabled(true);  // 启用

    const switches = m.requests
      .filter((r) => r.path.includes("/x/v2/history/shadow/set"))
      .map((r) => r.body?.switch);
    expect(switches).toEqual(["true", "false"]);
  });

  it("checks history disabled state", async () => {
    const m = await startMock({ "/x/v2/history/shadow": () => true });
    const { client } = await makeClient();
    expect(await client.data.isHistoryDisabled()).toBe(true);
  });

  it("throws LOGIN_REQUIRED without bili_jct for writes", async () => {
    const m = await startMock({ "/x/v2/history/toview/add": () => ({}) });
    const client = createBilibiliClient({ baseUrl: m.url, cookie: "SESSDATA=abc" });
    await expect(client.data.addToView(1)).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  });
});
