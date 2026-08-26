import { afterEach, describe, expect, it } from "vitest";
import { Context, Service } from "@deepseek-ai/cordis";
import { FileSettingsProvider } from "@deepseek-ai/dsh-settings-file";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config, apply, inject } from "../src/index.js";
import type { ResolvedConfig } from "../src/config.js";

/**
 * 真实组合测试:FileSettingsProvider + 本插件 apply,验证设置页开关
 * (settings 文档 dsh-sdk-tools 节)→ 工具注册的实时闭环。
 */

/** 记录工具注册/注销的假 tools service(足够覆盖 register 返回 disposer 的契约)。 */
class FakeTools extends Service {
  static inject: string[] = [];
  active = new Set<string>();

  constructor(ctx: Context) {
    super(ctx, "tools" as never);
  }

  register(definition: { name: string }): () => void {
    this.active.add(definition.name);
    return () => { this.active.delete(definition.name); };
  }
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
});

/** 默认 entry config(与 agent.cordis.yml 一致:bilibili/netease/ffmpeg/lol 开)。 */
function entry(): ResolvedConfig {
  return {
    bilibili: { enabled: true, outputDir: "~/Downloads/bilibili" },
    netease: { enabled: true, outputDir: "~/Downloads/netease", level: "exhigh" },
    ffmpeg: { enabled: true },
    email: { enabled: false },
    lol: { enabled: true },
    vrchat: { enabled: false },
    logs: { enabled: true, remote: true, local: false },
  };
}

/** 启动一个含 settings provider + 本插件的上下文,返回 tools 与 settings 面。 */
async function boot(): Promise<{
  ctx: Context;
  tools: FakeTools;
  settingsPath: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "dsh-sdk-tools-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const settingsPath = join(dir, "settings.yaml");

  const ctx = new Context();

  const toolsFiber = ctx.plugin(FakeTools);
  cleanups.push(async () => { await toolsFiber.dispose(); });
  await toolsFiber;

  const settingsFiber = ctx.plugin(FileSettingsProvider, { path: settingsPath, watch: false });
  cleanups.push(async () => { await settingsFiber.dispose(); });
  await settingsFiber;

  // cordis 直接装载裸函数会丢 inject 声明;用插件对象形态(loader 的等价包装)。
  const pluginFiber = ctx.plugin({ apply, inject, Config }, entry());
  cleanups.push(async () => { await pluginFiber.dispose(); });
  await pluginFiber;

  return { ctx, tools: ctx.tools as unknown as FakeTools, settingsPath };
}

describe("settings → tools live wiring", () => {
  it("registers entry-enabled packages initially", async () => {
    const { tools } = await boot();
    expect(tools.active.has("bilibili_parse")).toBe(true);
    expect(tools.active.has("netease_account")).toBe(true);
    expect(tools.active.has("ffmpeg_probe")).toBe(true);
    expect(tools.active.has("lol_summoner")).toBe(true);
    // email / vrchat 默认关。
    expect(tools.active.has("email_send")).toBe(false);
    expect(tools.active.has("vrchat_whoami")).toBe(false);
  });

  it("settings document overrides entry enabled and live-re-registers tools", async () => {
    const { ctx, tools } = await boot();
    const ns = "dsh-sdk-tools" as never;
    // 关掉 bilibili、打开 vrchat。
    await ctx.settings.update(ns, { bilibili: false, vrchat: true });
    expect(tools.active.has("bilibili_parse")).toBe(false);
    expect(tools.active.has("vrchat_whoami")).toBe(true);
    // 未触碰的包不受影响。
    expect(tools.active.has("netease_account")).toBe(true);
    // 再恢复 bilibili:工具回来。
    await ctx.settings.update(ns, { bilibili: true });
    expect(tools.active.has("bilibili_parse")).toBe(true);
  });

  it("clearing the user section falls back to entry defaults", async () => {
    const { ctx, tools } = await boot();
    const ns = "dsh-sdk-tools" as never;
    await ctx.settings.update(ns, { bilibili: false });
    expect(tools.active.has("bilibili_parse")).toBe(false);
    await ctx.settings.replace(ns, {});
    expect(tools.active.has("bilibili_parse")).toBe(true);
  });
});
