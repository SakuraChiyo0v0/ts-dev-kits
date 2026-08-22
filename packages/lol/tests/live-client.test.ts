import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { LiveClientApi } from "../src/index.js";

let server: Server | null = null;
let baseUrl = "";

function startServer(
  handler: (path: string, res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: string): void }) => void,
): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      handler(req.url ?? "/", {
        writeHead: (status, headers) => res.writeHead(status, headers),
        end: (body) => res.end(body),
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      if (address && typeof address === "object") {
        baseUrl = `http://127.0.0.1:${address.port}`;
      }
      resolve();
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    const s = server;
    server = null;
    s.close(() => resolve());
  });
}

afterEach(async () => {
  await stopServer();
});

describe("LiveClientApi", () => {
  it("GETs allgamedata as JSON", async () => {
    await startServer((path, res) => {
      expect(path).toBe("/liveclientdata/allgamedata");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ gameData: { gameMode: "CLASSIC" }, allPlayers: [] }));
    });
    const client = new LiveClientApi({ baseUrl });
    const data = await client.getAllGameData();
    expect(data.gameData.gameMode).toBe("CLASSIC");
    await client.close();
  });

  it("GETs activeplayername as plain text", async () => {
    await startServer((path, res) => {
      expect(path).toBe("/liveclientdata/activeplayername");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("RiotAyoob");
    });
    const client = new LiveClientApi({ baseUrl });
    const name = await client.getActivePlayerName();
    expect(name).toBe("RiotAyoob");
    await client.close();
  });

  it("builds player sub-endpoints with URL encoding", async () => {
    const seen: string[] = [];
    await startServer((path, res) => {
      seen.push(path);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    const client = new LiveClientApi({ baseUrl });
    await client.getPlayerScores("Faker#KR1");
    await client.getPlayerItems("A B");
    expect(seen[0]).toBe("/liveclientdata/player/Faker%23KR1/scores");
    expect(seen[1]).toBe("/liveclientdata/player/A%20B/items");
    await client.close();
  });

  it("throws NOT_FOUND on 404", async () => {
    await startServer((_path, res) => {
      res.writeHead(404);
      res.end();
    });
    const client = new LiveClientApi({ baseUrl });
    await expect(client.getGameStats()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await client.close();
  });

  it("throws TIMEOUT when server is slow", async () => {
    await startServer((_path, res) => {
      // 不响应，让客户端超时
      setTimeout(() => res.end(), 500).unref();
    });
    const client = new LiveClientApi({ baseUrl, timeoutMs: 50 });
    await expect(client.getGameStats()).rejects.toMatchObject({ code: "TIMEOUT" });
    await client.close();
  });

  it("throws CONNECTION when server is unreachable", async () => {
    const client = new LiveClientApi({ baseUrl: "http://127.0.0.1:1" });
    await expect(client.getGameStats()).rejects.toMatchObject({ code: "CONNECTION" });
    await client.close();
  });

  it("throws CONNECTION after close and close() is idempotent", async () => {
    await startServer((_path, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    const client = new LiveClientApi({ baseUrl });
    await client.close();
    await expect(client.getGameStats()).rejects.toMatchObject({ code: "CONNECTION" });
    await expect(client.close()).resolves.toBeUndefined();
  });
});
