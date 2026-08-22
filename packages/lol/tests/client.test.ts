import { afterEach, describe, expect, it } from "vitest";

import { createLolClient, LolError } from "../src/index.js";
import { MockLcuServer } from "./helpers/mock-lcu-server.js";

let server: MockLcuServer | null = null;

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
});

async function startServer(): Promise<MockLcuServer> {
  const srv = await MockLcuServer.start();
  server = srv;
  return srv;
}

async function startClient(options: { server?: string; token?: string } = {}) {
  const srv = await startServer();
  const client = await createLolClient({
    connection: {
      pid: 1,
      port: srv.getPort(),
      token: options.token ?? "test-token",
      ...(options.server ? { server: options.server } : {}),
    },
    scheme: "http",
  });
  return { client, srv };
}

describe("createLolClient", () => {
  it("exposes summoner/matchHistory/ranked/gameData/gameflow APIs", async () => {
    const { client, srv } = await startClient();

    srv.route("GET", "/lol-summoner/v1/current-summoner", () => ({
      body: { displayName: "TestSummoner", summonerId: 7, puuid: "p1" },
    }));
    srv.route("GET", "/lol-gameflow/v1/gameflow-phase", () => ({ body: "Lobby" }));

    const summoner = await client.summoner.getCurrent();
    expect(summoner.displayName).toBe("TestSummoner");

    const phase = await client.gameflow.getPhase();
    expect(phase).toBe("Lobby");

    expect(client.events).toBeDefined();
    expect(client.matchHistory).toBeDefined();
    expect(client.ranked).toBeDefined();
    expect(client.gameData).toBeDefined();
    await client.close();
  });

  it("queries match history with begIndex/endIndex params", async () => {
    const { client, srv } = await startClient();
    srv.route("GET", "/lol-match-history/v1/products/lol/p1/matches", ({ url }) => ({
      body: {
        games: {
          gameCount: 1,
          gameIndexBegin: Number(url.searchParams.get("begIndex")),
          gameIndexEnd: Number(url.searchParams.get("endIndex")),
          games: [{ gameId: 123 }],
        },
      },
    }));

    const games = await client.matchHistory.getMatches("p1", { begIndex: 5, endIndex: 9 });
    expect(games.gameIndexBegin).toBe(5);
    expect(games.gameIndexEnd).toBe(9);
    expect(games.games[0]).toMatchObject({ gameId: 123 });
    await client.close();
  });

  it("throws NOT_FOUND for missing match history", async () => {
    const { client } = await startClient();
    await expect(client.matchHistory.getMatches("nobody")).rejects.toBeInstanceOf(LolError);
    await client.close();
  });

  it("exposes SGP channel on Tencent servers", async () => {
    const { client, srv } = await startClient({ server: "HN1" });
    srv.route("GET", "/entitlements/v1/token", () => ({
      body: { accessToken: "initial-sgp-token" },
    }));
    expect(client.sgp).toBeDefined();
    await client.close();
  });

  it("does not expose SGP channel on non-Tencent servers", async () => {
    const { client, srv } = await startClient({ server: "NA1" });
    void srv;
    expect(client.sgp).toBeUndefined();
    await expect(client.matchHistory.getMatchesViaSgp("p1")).rejects.toThrow(
      /SGP 通道不可用/,
    );
    await client.close();
  });

  it("close() is idempotent", async () => {
    const { client } = await startClient();
    await client.close();
    await expect(client.close()).resolves.toBeUndefined();
  });

  it("close() is idempotent with SGP channel (Tencent)", async () => {
    const { client, srv } = await startClient({ server: "HN1" });
    srv.route("GET", "/entitlements/v1/token", () => ({
      body: { accessToken: "sgp-token" },
    }));
    expect(client.sgp).toBeDefined();
    await client.close();
    await expect(client.close()).resolves.toBeUndefined();
  });
});
