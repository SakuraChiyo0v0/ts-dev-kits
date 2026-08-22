import { afterEach, describe, expect, it } from "vitest";

import { createLolClient } from "../src/index.js";
import { MockLcuServer } from "./helpers/mock-lcu-server.js";

let server: MockLcuServer | null = null;

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
});

async function startClient() {
  server = await MockLcuServer.start();
  // 未注册的路径默认返回 200 空响应，便于只断言请求形态
  server.routeFallback(() => ({ body: {} }));
  const client = await createLolClient({
    connection: { pid: 1, port: server.getPort(), token: "test-token" },
    scheme: "http",
  });
  return client;
}

function lastRequest() {
  const req = server!.requests.at(-1);
  if (!req) {
    throw new Error("no request recorded");
  }
  return req;
}

describe("champSelect", () => {
  it("picks a champion with PATCH body", async () => {
    const client = await startClient();
    await client.champSelect.pick(10, 1);
    const req = lastRequest();
    expect(req.method).toBe("PATCH");
    expect(req.path).toBe("/lol-champ-select/v1/session/actions/10");
    expect(req.body).toEqual({ championId: 1, type: "pick" });
    await client.close();
  });

  it("locks pick when completed=true", async () => {
    const client = await startClient();
    await client.champSelect.pick(10, 1, true);
    expect(lastRequest().body).toEqual({ championId: 1, type: "pick", completed: true });
    await client.close();
  });

  it("bans a champion", async () => {
    const client = await startClient();
    await client.champSelect.ban(3, 42);
    expect(lastRequest().body).toEqual({ championId: 42, type: "ban" });
    await client.close();
  });

  it("accepts a trade with two POSTs (accept + clear)", async () => {
    const client = await startClient();
    await client.champSelect.acceptTrade(7);
    const paths = server!.requests.map((r) => r.path);
    expect(paths).toEqual([
      "/lol-champ-select/v1/session/trades/7/accept",
      "/lol-champ-select/v1/ongoing-trade/7/clear",
    ]);
    await client.close();
  });

  it("accepts a swap with two POSTs (accept + clear)", async () => {
    const client = await startClient();
    await client.champSelect.acceptSwap(9);
    const paths = server!.requests.map((r) => r.path);
    expect(paths).toEqual([
      "/lol-champ-select/v1/session/swaps/9/accept",
      "/lol-champ-select/v1/ongoing-swap/9/clear",
    ]);
    await client.close();
  });

  it("selects skin/spells via my-selection PATCH", async () => {
    const client = await startClient();
    await client.champSelect.selectConfig({ skinId: 500, spell1Id: 4 });
    const req = lastRequest();
    expect(req.path).toBe("/lol-champ-select/v1/session/my-selection");
    expect(req.body).toEqual({ selectedSkinId: 500, spell1Id: 4 });
    await client.close();
  });

  it("creates and reads rune pages", async () => {
    const client = await startClient();
    server!.route("GET", "/lol-perks/v1/currentpage", () => ({
      body: { id: 1, name: "page", primaryStyleId: 8100, isDeletable: true },
    }));
    await client.champSelect.createRunePage({
      name: "opgg",
      primaryStyleId: 8100,
      subStyleId: 8300,
      selectedPerkIds: [8112, 8124, 8138, 8135, 8306, 8347],
    });
    const createReq = lastRequest();
    expect(createReq.method).toBe("POST");
    expect(createReq.path).toBe("/lol-perks/v1/pages");
    expect(createReq.body).toMatchObject({
      name: "opgg",
      primaryStyleId: 8100,
      subStyleId: 8300,
      current: true,
    });

    const page = await client.champSelect.getCurrentRunePage();
    expect(page.id).toBe(1);
    await client.close();
  });
});

describe("lobby", () => {
  it("creates a 5v5 practice lobby with default map", async () => {
    const client = await startClient();
    await client.lobby.create5v5PracticeLobby({ name: "训练房" });
    const req = lastRequest();
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/lol-lobby/v2/lobby");
    expect(req.body).toMatchObject({ queueId: 3100, isCustom: true });
    const body = req.body as { customGameLobby: { configuration: Record<string, unknown>; lobbyPassword: string } };
    expect(body.customGameLobby.configuration).toMatchObject({
      gameMode: "PRACTICETOOL",
      mapId: 11,
      teamSize: 5,
    });
    expect(body.customGameLobby).toMatchObject({ lobbyName: "训练房" });
    expect(body.customGameLobby.lobbyPassword).toBe(""); // 无密码时传空串（LCU 必填字段）
    await client.close();
  });

  it("creates a lobby with password and custom map", async () => {
    const client = await startClient();
    await client.lobby.create5v5PracticeLobby({ name: "房", password: "123", mapId: 12 });
    const body = lastRequest().body as {
      customGameLobby: { configuration: Record<string, unknown>; lobbyPassword: string };
    };
    expect(body.customGameLobby.configuration.mapId).toBe(12);
    expect(body.customGameLobby.lobbyPassword).toBe("123");
    await client.close();
  });
});

describe("profile", () => {
  it("sets profile background via summoner-profile POST", async () => {
    const client = await startClient();
    await client.profile.setBackground(550);
    const req = lastRequest();
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/lol-summoner/v1/current-summoner/summoner-profile");
    expect(req.body).toEqual({ key: "backgroundSkinId", value: 550 });
    await client.close();
  });

  it("sets rank shown via chat me PUT", async () => {
    const client = await startClient();
    await client.profile.setRankShown("RANKED_SOLO_5x5", "CHALLENGER", "I");
    const req = lastRequest();
    expect(req.method).toBe("PUT");
    expect(req.path).toBe("/lol-chat/v1/me");
    expect(req.body).toEqual({
      lol: {
        rankedLeagueQueue: "RANKED_SOLO_5x5",
        rankedLeagueTier: "CHALLENGER",
        rankedLeagueDivision: "I",
      },
    });
    await client.close();
  });

  it("removes tokens after reading current banner", async () => {
    const client = await startClient();
    server!.route("GET", "/lol-chat/v1/me", () => ({
      body: { lol: { bannerIdSelected: 3 } },
    }));
    await client.profile.removeTokens();
    const req = lastRequest();
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/lol-challenges/v1/update-player-preferences/");
    expect(req.body).toEqual({ challengeIds: [], bannerAccent: 3 });
    await client.close();
  });
});

describe("chat", () => {
  it("sets status message", async () => {
    const client = await startClient();
    await client.chat.setStatus("在线冲分中");
    const req = lastRequest();
    expect(req.method).toBe("PUT");
    expect(req.path).toBe("/lol-chat/v1/me");
    expect(req.body).toEqual({ statusMessage: "在线冲分中" });
    await client.close();
  });

  it("sets availability", async () => {
    const client = await startClient();
    await client.chat.setAvailability("dnd");
    expect(lastRequest().body).toEqual({ availability: "dnd" });
    await client.close();
  });

  it("sends a message to a conversation", async () => {
    const client = await startClient();
    await client.chat.sendMessage("conv-1", "开黑？");
    const req = lastRequest();
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/lol-chat/v1/conversations/conv-1/messages");
    expect(req.body).toEqual({ body: "开黑？" });
    await client.close();
  });

  it("sends a friend request by name", async () => {
    const client = await startClient();
    await client.chat.sendFriendRequest("召唤师名");
    const req = lastRequest();
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/lol-chat/v1/friend-requests");
    expect(req.body).toEqual({ name: "召唤师名" });
    await client.close();
  });

  it("sends a client notification toast", async () => {
    const client = await startClient();
    await client.chat.sendNotification({ title: "提醒", content: "该开黑了" });
    const req = lastRequest();
    expect(req.path).toBe("/player-notifications/v1/notifications");
    expect(req.body).toMatchObject({
      state: "toast",
      data: { title: "提醒", details: "该开黑了" },
    });
    await client.close();
  });

  it("reads me and conversations", async () => {
    const client = await startClient();
    server!.route("GET", "/lol-chat/v1/me", () => ({
      body: { name: "Me", availability: "chat", statusMessage: "hi" },
    }));
    server!.route("GET", "/lol-chat/v1/conversations", () => ({
      body: [{ id: "c1", type: "chat", unreadCount: 0 }],
    }));
    const me = await client.chat.getMe();
    expect(me.name).toBe("Me");
    const convs = await client.chat.getConversations();
    expect(convs[0]).toMatchObject({ id: "c1" });
    await client.close();
  });
});
