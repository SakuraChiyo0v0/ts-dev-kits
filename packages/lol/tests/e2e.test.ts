/**
 * 真实客户端 E2E 冒烟测试。
 * 默认跳过；设置环境变量 LOL_E2E=1 且本机运行着英雄联盟客户端时执行。
 * 用法：LOL_E2E=1 pnpm --filter @sakurachiyo0v0/lol test
 */

import { describe, expect, it } from "vitest";

import { createLolClient } from "../src/index.js";

const E2E = process.env.LOL_E2E === "1";

describe.skipIf(!E2E)("e2e against real client", () => {
  it("discovers, connects, queries summoner and gameflow", async () => {
    const client = await createLolClient();
    try {
      const me = await client.summoner.getCurrent();
      expect(me.displayName).toBeTruthy();
      expect(me.puuid).toBeTruthy();

      const phase = await client.gameflow.getPhase();
      expect(typeof phase).toBe("string");

      const games = await client.matchHistory.getMatches(me.puuid, { begIndex: 0, endIndex: 4 });
      expect(Array.isArray(games.games)).toBe(true);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("subscribes to gameflow phase events", async () => {
    const client = await createLolClient();
    const phases: string[] = [];
    const off = client.events.onGameflowPhase((phase) => {
      phases.push(phase);
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    off();
    await client.close();
    // 2 秒内可能没有状态变更，此处只验证订阅不报错
    expect(Array.isArray(phases)).toBe(true);
  }, 15_000);
});
