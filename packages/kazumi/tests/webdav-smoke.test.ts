/**
 * 真实 WebDAV 冒烟(需本机已 sc-config setup,配置 dav.amechan.cloud)。
 * 无全局配置时跳过。
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { createConfigCenter } from "@sakurachiyo0v0/config";
import { RuleSync } from "../src/rules/sync.js";

const HAS_GLOBAL = existsSync(
  process.env.AMECHAN_CONFIG_HOME
    ? `${process.env.AMECHAN_CONFIG_HOME}/amechan/config.json`
    : `${process.env.HOME ?? "~"}/.config/amechan/config.json`,
);

const describeReal = HAS_GLOBAL ? describe : describe.skip;

describeReal("真实 WebDAV 规则同步冒烟", () => {
  it("add → list → get → remove 端到端", async () => {
    const center = createConfigCenter();
    const sync = new RuleSync(true, center);
    expect(sync.enabled).toBe(true);
    const name = `smoke-${Date.now()}`;
    const rule = { api: "1", name, baseURL: "https://smoke.example.com" };
    await sync.put(name, rule);
    try {
      const names = await sync.list();
      expect(names).toContain(name);
      const got = await sync.get(name);
      expect(got).toEqual(rule);
    } finally {
      await sync.remove(name);
    }
    const after = await sync.list();
    expect(after).not.toContain(name);
  }, 30_000);
});
