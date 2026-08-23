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

describe("UserApi", () => {
  const cardRoute = {
    "/x/web-interface/card": () => ({
      card: {
        mid: 389242186,
        name: "何日不整活",
        face: "https://example.com/face.jpg",
        sign: "个人签名",
        fans: 76,
        attention: 233,
        level_info: { current_level: 5 },
        vip: { status: 1 },
        official_verify: { type: 0 },
        description: "空间简介",
      },
    }),
  };

  it("queries a user card", async () => {
    const m = await startMock(cardRoute);
    const { client } = await makeClient();
    const card = await client.user.getCard(389242186);

    expect(card).toMatchObject({
      mid: 389242186,
      name: "何日不整活",
      face: "https://example.com/face.jpg",
      sign: "个人签名",
      fans: 76,
      following: 233,
      level: 5,
      vip: true,
      official: true,
      description: "空间简介",
    });
    const req = m.requests.find((r) => r.path.includes("/x/web-interface/card"));
    expect(req?.path).toContain("mid=389242186");
  });

  it("maps non-vip / non-official users correctly", async () => {
    const m = await startMock({
      "/x/web-interface/card": () => ({
        card: {
          mid: 1,
          name: "普通用户",
          fans: 0,
          attention: 0,
          level_info: { current_level: 0 },
          vip: { status: 0 },
          official_verify: { type: -1 },
        },
      }),
    });
    const { client } = await makeClient();
    const card = await client.user.getCard(1);

    expect(card.vip).toBe(false);
    expect(card.official).toBe(false);
    expect(card.level).toBe(0);
  });

  it("batch queries multiple users", async () => {
    const m = await startMock(cardRoute);
    const { client } = await makeClient();
    const cards = await client.user.getCards([389242186, 2]);

    expect(cards).toHaveLength(2);
    expect(cards[0]?.name).toBe("何日不整活");
  });
});
