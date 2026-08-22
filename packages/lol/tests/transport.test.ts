import { afterEach, describe, expect, it } from "vitest";

import { HttpLcuTransport, LolError, sanitize } from "../src/index.js";
import { MockLcuServer } from "./helpers/mock-lcu-server.js";

let server: MockLcuServer | null = null;

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
});

function createTransport(overrides: Partial<ConstructorParameters<typeof HttpLcuTransport>[0]> = {}) {
  if (!server) {
    throw new Error("mock server not started");
  }
  return new HttpLcuTransport({
    port: server.getPort(),
    token: "test-token",
    scheme: "http",
    ...overrides,
  });
}

describe("HttpLcuTransport", () => {
  it("sends BasicAuth and returns parsed JSON", async () => {
    server = await MockLcuServer.start({ token: "test-token" });
    server.route("GET", "/lol-summoner/v1/current-summoner", () => ({
      body: { displayName: "Seraphine", summonerId: 42 },
    }));

    const transport = createTransport();
    const result = await transport.request<{ displayName: string; summonerId: number }>({
      method: "GET",
      path: "/lol-summoner/v1/current-summoner",
    });

    expect(result).toEqual({ displayName: "Seraphine", summonerId: 42 });
    const recorded = server.requests[0]!;
    expect(recorded.auth).toEqual({ user: "riot", pass: "test-token" });
    await transport.close();
  });

  it("classifies 404 as NOT_FOUND", async () => {
    server = await MockLcuServer.start();
    const transport = createTransport();
    await expect(
      transport.request({ method: "GET", path: "/lol-match-history/v1/games/1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await transport.close();
  });

  it("classifies 429 as RATE_LIMIT", async () => {
    server = await MockLcuServer.start();
    server.route("GET", "/lol-ranked/v1/ranked-stats/p1", () => ({
      status: 429,
      body: { errorCode: "RATE_LIMIT", httpStatus: 429 },
    }));
    const transport = createTransport();
    await expect(
      transport.request({ method: "GET", path: "/lol-ranked/v1/ranked-stats/p1" }),
    ).rejects.toMatchObject({ code: "RATE_LIMIT" });
    await transport.close();
  });

  it("classifies LCU error-body 404 as NOT_FOUND even with 200 status", async () => {
    server = await MockLcuServer.start();
    server.route("GET", "/lol-summoner/v2/summoners/puuid/nobody", () => ({
      status: 200,
      body: { errorCode: "SUMMONER_NOT_FOUND", httpStatus: 404 },
    }));
    const transport = createTransport();
    await expect(
      transport.request({ method: "GET", path: "/lol-summoner/v2/summoners/puuid/nobody" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await transport.close();
  });

  it("retries GET on transient 500 then succeeds", async () => {
    server = await MockLcuServer.start();
    let attempts = 0;
    server.route("GET", "/lol-gameflow/v1/gameflow-phase", () => {
      attempts += 1;
      if (attempts === 1) {
        return { status: 500, body: { errorCode: "INTERNAL", httpStatus: 500 } };
      }
      return { body: "ChampSelect" };
    });

    const transport = createTransport();
    const phase = await transport.request<string>({
      method: "GET",
      path: "/lol-gameflow/v1/gameflow-phase",
    });
    expect(phase).toBe("ChampSelect");
    expect(attempts).toBe(2);
    await transport.close();
  });

  it("does not retry POST", async () => {
    server = await MockLcuServer.start();
    let attempts = 0;
    server.route("POST", "/lol-matchmaking/v1/ready-check/accept", () => {
      attempts += 1;
      return { status: 500, body: { errorCode: "INTERNAL", httpStatus: 500 } };
    });

    const transport = createTransport();
    await expect(
      transport.request({ method: "POST", path: "/lol-matchmaking/v1/ready-check/accept" }),
    ).rejects.toBeInstanceOf(LolError);
    expect(attempts).toBe(1);
    await transport.close();
  });

  it("times out slow requests with TIMEOUT", async () => {
    server = await MockLcuServer.start({ delayMs: 200 });
    server.route("GET", "/lol-gameflow/v1/gameflow-phase", () => ({ body: "Lobby" }));

    const transport = createTransport({ timeoutMs: 50 });
    await expect(
      transport.request({ method: "GET", path: "/lol-gameflow/v1/gameflow-phase" }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    await transport.close();
  });

  it("rejects requests after close", async () => {
    server = await MockLcuServer.start();
    server.route("GET", "/lol-gameflow/v1/gameflow-phase", () => ({ body: "Lobby" }));
    const transport = createTransport();
    await transport.close();
    await expect(
      transport.request({ method: "GET", path: "/lol-gameflow/v1/gameflow-phase" }),
    ).rejects.toMatchObject({ code: "CONNECTION" });
  });

  it("returns binary asset bodies as Buffer", async () => {
    server = await MockLcuServer.start();
    const icon = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    server.route("GET", "/lol-game-data/assets/v1/champion-icons/1.png", () => ({
      body: icon,
      headers: { "Content-Type": "image/png" },
    }));

    const transport = createTransport();
    const raw = await transport.requestRaw({
      method: "GET",
      path: "/lol-game-data/assets/v1/champion-icons/1.png",
    });
    expect(Buffer.isBuffer(raw.body)).toBe(true);
    expect((raw.body as Buffer).equals(icon)).toBe(true);
    await transport.close();
  });
});

describe("sanitize", () => {
  it("redacts secrets from messages", () => {
    const message = "failed with token supersecret and more";
    expect(sanitize(message, ["supersecret"])).toBe("failed with token [REDACTED] and more");
  });

  it("redacts remoting-auth-token command-line fragments", () => {
    const message = "cmdline: --remoting-auth-token=abc123 --app-port=1234";
    expect(sanitize(message)).toContain("--remoting-auth-token=[REDACTED]");
    expect(sanitize(message)).not.toContain("abc123");
  });
});
