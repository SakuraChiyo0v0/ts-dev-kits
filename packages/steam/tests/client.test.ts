import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSteamClient } from "../src/client.js";
import { startMockSteamServer, type MockSteamServer } from "./helpers/mock-steam-server.js";

describe("createSteamClient", () => {
  let server: MockSteamServer;

  beforeEach(async () => {
    server = await startMockSteamServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("probe() 返回服务器信息(无需 key)", async () => {
    const client = createSteamClient({ baseUrls: server.baseUrls });
    const info = await client.probe();
    expect(info.servertime).toBe(1700000000);
    expect(info.servertimestring).toBe("test");
    await client.close();
  });

  it("getSupportedApiList() 未配置 key → CONFIGURATION", async () => {
    const client = createSteamClient({ baseUrls: server.baseUrls });
    await expect(client.getSupportedApiList()).rejects.toMatchObject({ code: "CONFIGURATION" });
    await client.close();
  });

  it("getSupportedApiList() 带 key 返回接口清单", async () => {
    const client = createSteamClient({ apiKey: "TEST_KEY", baseUrls: server.baseUrls });
    const list = await client.getSupportedApiList();
    expect(list).toMatchObject({ interfaces: [{ name: "ISteamApps" }] });
    await client.close();
  });

  it("hasApiKey / hasPublisherKey / hasSession 标记", () => {
    const client = createSteamClient({ apiKey: "K", publisherKey: "P", cookie: "sessionid=x" });
    expect(client.hasApiKey).toBe(true);
    expect(client.hasPublisherKey).toBe(true);
    expect(client.hasSession).toBe(true);
  });
});
