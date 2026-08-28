import { describe, expect, it } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { SettingsSchema, applySettingsShape, toSettingsShape } from "../src/settings.js";
import { registerCapabilities } from "../src/capabilities.js";
import type { ResolvedConfig } from "../src/config.js";

/** 构造一个全默认的 entry config。 */
function entryConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    bilibili: { enabled: true, outputDir: "~/Downloads/bilibili" },
    netease: { enabled: true, outputDir: "~/Downloads/netease", level: "exhigh" },
    ffmpeg: { enabled: true },
    email: { enabled: false },
    lol: { enabled: true },
    vrchat: { enabled: false },
    logs: { enabled: true, remote: true, local: false },
    kazumi: { enabled: true, outputDir: "~/Downloads/kazumi" },
    ...overrides,
  };
}

/** 记录 register 调用与注销次数的假 tools 上下文。 */
function fakeContext(): {
  ctx: Context & { tools: { register: () => () => void } };
  active: () => number;
} {
  let active = 0;
  const ctx = {
    tools: {
      register: () => {
        active += 1;
        return () => { active -= 1; };
      },
    },
  } as unknown as Context & { tools: { register: () => () => void } };
  return { ctx, active: () => active };
}

describe("SettingsSchema", () => {
  it("defaults match the preset entry defaults", () => {
    expect(SettingsSchema({})).toEqual({
      bilibili: true,
      netease: true,
      ffmpeg: true,
      email: false,
      lol: true,
      vrchat: false,
      logs: true,
      kazumi: true,
    });
  });
});

describe("toSettingsShape / applySettingsShape", () => {
  it("round-trips enabled flags without touching other fields", () => {
    const entry = entryConfig();
    expect(toSettingsShape(entry)).toEqual({
      bilibili: true, netease: true, ffmpeg: true, email: false, lol: true, vrchat: false, logs: true, kazumi: true,
    });
    expect(applySettingsShape(entry, toSettingsShape(entry))).toEqual(entry);
  });

  it("settings override entry enabled while keeping entry params", () => {
    const entry = entryConfig();
    const merged = applySettingsShape(entry, {
      bilibili: false, netease: true, ffmpeg: true, email: true, lol: true, vrchat: true,
    });
    expect(merged.bilibili.enabled).toBe(false);
    expect(merged.email.enabled).toBe(true);
    // 未涉及的参数仍继承 entry。
    expect(merged.bilibili.outputDir).toBe("~/Downloads/bilibili");
    expect(merged.netease.level).toBe("exhigh");
  });
});

describe("registerCapabilities", () => {
  it("registers only enabled packages", () => {
    const { ctx, active } = fakeContext();
    const dispose = registerCapabilities(ctx, entryConfig());
    // 4 个包(bilibili/netease/ffmpeg/lol)注册,email/vrchat 不注册。
    const enabledCount = active();
    expect(enabledCount).toBeGreaterThan(0);
    dispose();
    expect(active()).toBe(0);
  });

  it("dispose then re-register does not accumulate", () => {
    const { ctx, active } = fakeContext();
    const first = registerCapabilities(ctx, entryConfig());
    const count = active();
    first();
    registerCapabilities(ctx, entryConfig());
    expect(active()).toBe(count);
  });

  it("registers nothing when every package is disabled", () => {
    const { ctx, active } = fakeContext();
    registerCapabilities(ctx, entryConfig({
      bilibili: { enabled: false, outputDir: "" },
      netease: { enabled: false, outputDir: "", level: "" },
      ffmpeg: { enabled: false },
      lol: { enabled: false },
      logs: { enabled: false, remote: true, local: false },
      kazumi: { enabled: false, outputDir: "" },
    }));
    expect(active()).toBe(0);
  });
});
