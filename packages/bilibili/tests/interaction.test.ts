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

describe("InteractionApi (read-only)", () => {
  it("checks liked state", async () => {
    const m = await startMock({ "/x/web-interface/archive/has/like": () => ({ liked: 1 }) });
    const { client } = await makeClient();
    expect(await client.interaction.isLiked(170001)).toBe(true);

    const req = m.requests.find((r) => r.path.includes("/x/web-interface/archive/has/like"));
    expect(req?.path).toContain("aid=170001");
  });

  it("checks not-liked state with bvid", async () => {
    const m = await startMock({ "/x/web-interface/archive/has/like": () => ({ liked: 0 }) });
    const { client } = await makeClient();
    expect(await client.interaction.isLiked("BV1xx411c7mD")).toBe(false);

    const req = m.requests.find((r) => r.path.includes("/x/web-interface/archive/has/like"));
    expect(req?.path).toContain("bvid=BV1xx411c7mD");
  });
});
