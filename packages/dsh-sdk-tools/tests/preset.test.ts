import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { load } from "js-yaml";

const presetsDir = join(dirname(fileURLToPath(import.meta.url)), "../presets/ts-dev-kits");

describe("ts-dev-kits preset template", () => {
  it("agent.cordis.yml is a valid top-level list of plugin rows", async () => {
    const content = await readFile(join(presetsDir, "agent.cordis.yml"), "utf8");
    const rows = load(content) as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.name).toBe("@sakurachiyo0v0/dsh-sdk-tools");
    // config 必须与插件 Config schema 兼容:email 默认关,其余默认开
    const config = row.config as { email?: { enabled?: boolean }; bilibili?: { enabled?: boolean } };
    expect(config.email?.enabled).toBe(false);
    expect(config.bilibili?.enabled).toBe(true);
  });

  it("preset.yml carries display metadata", async () => {
    const content = await readFile(join(presetsDir, "preset.yml"), "utf8");
    const meta = load(content) as { name?: string; description?: string };
    expect(typeof meta.name).toBe("string");
    expect(typeof meta.description).toBe("string");
    expect(meta.name).toBe("ts-dev-kits");
  });
});
