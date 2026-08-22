import { afterEach, describe, expect, it } from "vitest";

import { EventBus, HttpLcuTransport } from "../src/index.js";
import { MockLcuServer } from "./helpers/mock-lcu-server.js";

let server: MockLcuServer | null = null;

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
});

async function createEventBus(): Promise<EventBus> {
  server = await MockLcuServer.start();
  const transport = new HttpLcuTransport({
    port: server.getPort(),
    token: "test-token",
    scheme: "http",
  });
  return new EventBus(transport);
}

describe("EventBus", () => {
  it("delivers gameflow phase events with parsed payload", async () => {
    const events = await createEventBus();
    const received: string[] = [];
    const off = events.onGameflowPhase((phase) => {
      received.push(phase);
    });

    // 等待 WS 建立并完成订阅
    await new Promise((resolve) => setTimeout(resolve, 100));
    server!.broadcast("OnJsonApiEvent_lol-gameflow_v1_gameflow-phase", {
      uri: "/lol-gameflow/v1/gameflow-phase",
      eventType: "Update",
      data: "ChampSelect",
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toEqual(["ChampSelect"]);
    off();
  });

  it("stops delivering after unsubscribe", async () => {
    const events = await createEventBus();
    const received: string[] = [];
    const off = events.onGameflowPhase((phase) => {
      received.push(phase);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    off();
    server!.broadcast("OnJsonApiEvent_lol-gameflow_v1_gameflow-phase", {
      uri: "/lol-gameflow/v1/gameflow-phase",
      eventType: "Update",
      data: "InProgress",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toEqual([]);
  });

  it("filters events by uri", async () => {
    const events = await createEventBus();
    const received: string[] = [];
    events.onCurrentSummoner((summoner) => {
      received.push((summoner as { displayName: string }).displayName);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 相同事件名但不同 uri —— 不应触发
    server!.broadcast("OnJsonApiEvent_lol-summoner_v1_current-summoner", {
      uri: "/lol-summoner/v1/other-endpoint",
      eventType: "Update",
      data: { displayName: "Wrong" },
    });
    server!.broadcast("OnJsonApiEvent_lol-summoner_v1_current-summoner", {
      uri: "/lol-summoner/v1/current-summoner",
      eventType: "Update",
      data: { displayName: "Right" },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toEqual(["Right"]);
  });

  it("delivers SGP token events only when accessToken present", async () => {
    const events = await createEventBus();
    const received: string[] = [];
    events.onSgpToken((token) => {
      received.push(token);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    server!.broadcast("OnJsonApiEvent_entitlements_v1_token", {
      uri: "/entitlements/v1/token",
      eventType: "Update",
      data: { accessToken: "sgp-token-1" },
    });
    server!.broadcast("OnJsonApiEvent_entitlements_v1_token", {
      uri: "/entitlements/v1/token",
      eventType: "Update",
      data: { somethingElse: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toEqual(["sgp-token-1"]);
  });
});
