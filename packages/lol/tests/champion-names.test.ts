import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { BUILTIN_CHAMPION_NAMES, ChampionNamesService } from "../src/index.js";

const FIXTURE = [
  { id: 1, name: "黑暗之女", alias: "Annie" },
  { id: 876, name: "含羞蓓蕾", alias: "Lillia" },
  { id: 950, name: "百裂冥犬", alias: "Naafiri" },
  { id: -1, name: "无", alias: "None" },
  { id: 60103, name: "九尾妖狐", alias: "Ahri" },
];

let server: Server | null = null;
let baseUrl = "";
let hitCount = 0;
let payload: unknown = FIXTURE;
let status = 200;

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      hitCount += 1;
      if (status !== 200) {
        res.writeHead(status);
        res.end("error");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
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
  hitCount = 0;
  payload = FIXTURE;
  status = 200;
});

describe("ChampionNamesService", () => {
  it("refreshes from source and resolves names", async () => {
    await startServer();
    const svc = new ChampionNamesService({ sourceUrl: `${baseUrl}/champions`, cacheTtlMs: 60_000 });
    expect(await svc.getName(876)).toBe("含羞蓓蕾");
    expect(await svc.getName(950)).toBe("百裂冥犬");
    expect(hitCount).toBe(1);
    await svc.close();
  });

  it("filters placeholder and large ids from source data", async () => {
    await startServer();
    const svc = new ChampionNamesService({ sourceUrl: `${baseUrl}/champions` });
    const map = await svc.getMap();
    expect(map[-1]).toBeUndefined();
    expect(map[60103]).toBeUndefined();
    await svc.close();
  });

  it("serves from cache within TTL", async () => {
    await startServer();
    const svc = new ChampionNamesService({ sourceUrl: `${baseUrl}/champions`, cacheTtlMs: 60_000 });
    await svc.getMap();
    await svc.getMap();
    await svc.getName(1);
    expect(hitCount).toBe(1);
    await svc.close();
  });

  it("re-fetches after TTL expires", async () => {
    await startServer();
    const svc = new ChampionNamesService({ sourceUrl: `${baseUrl}/champions`, cacheTtlMs: 50 });
    await svc.getMap();
    await new Promise((r) => setTimeout(r, 60));
    await svc.getMap();
    expect(hitCount).toBe(2);
    await svc.close();
  });

  it("falls back to builtin table on HTTP error", async () => {
    await startServer();
    status = 500;
    const svc = new ChampionNamesService({ sourceUrl: `${baseUrl}/champions` });
    const map = await svc.getMap();
    expect(map).toBe(BUILTIN_CHAMPION_NAMES);
    expect(map[876]).toBe("含羞蓓蕾"); // 内置表也有
    await svc.close();
  });

  it("falls back to builtin table on malformed payload", async () => {
    await startServer();
    payload = { data: { 876: "含羞蓓蕾" } }; // 非数组
    const svc = new ChampionNamesService({ sourceUrl: `${baseUrl}/champions` });
    const map = await svc.getMap();
    expect(map).toBe(BUILTIN_CHAMPION_NAMES);
    await svc.close();
  });

  it("falls back to builtin table on empty array", async () => {
    await startServer();
    payload = [];
    const svc = new ChampionNamesService({ sourceUrl: `${baseUrl}/champions` });
    const map = await svc.getMap();
    expect(map).toBe(BUILTIN_CHAMPION_NAMES);
    await svc.close();
  });

  it("keeps stale cache when refresh fails after a success", async () => {
    await startServer();
    const svc = new ChampionNamesService({ sourceUrl: `${baseUrl}/champions`, cacheTtlMs: 50 });
    await svc.getMap();
    status = 500;
    await new Promise((r) => setTimeout(r, 60));
    const map = await svc.getMap();
    expect(map[876]).toBe("含羞蓓蕾"); // 旧缓存仍在
    await svc.close();
  });

  it("exposes builtin table and default source url", () => {
    expect(BUILTIN_CHAMPION_NAMES[103]).toBe("九尾妖狐");
    expect(BUILTIN_CHAMPION_NAMES[876]).toBe("含羞蓓蕾");
  });

  it("close is idempotent", async () => {
    const svc = new ChampionNamesService({ sourceUrl: "http://127.0.0.1:1/champions" });
    await svc.close();
    await svc.close();
  });
});
