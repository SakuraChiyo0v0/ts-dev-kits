import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStore, defaultAuthPath, resolveConfigRoot } from "../src/index.js";

const tempRoot = path.join(tmpdir(), `account-test-${process.pid}`);
const platformDir = path.join(tempRoot, "netease-music");

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("resolveConfigRoot", () => {
  it("honors AMECHAN_CONFIG_HOME override", () => {
    expect(resolveConfigRoot("win32", { AMECHAN_CONFIG_HOME: "C:\\custom" })).toBe("C:\\custom");
    expect(resolveConfigRoot("darwin", { AMECHAN_CONFIG_HOME: "/custom" })).toBe("/custom");
  });

  it("uses APPDATA on win32", () => {
    expect(resolveConfigRoot("win32", { APPDATA: "C:\\Users\\x\\AppData\\Roaming" })).toBe(
      "C:\\Users\\x\\AppData\\Roaming",
    );
  });

  it("uses Application Support on darwin", () => {
    const result = resolveConfigRoot("darwin", { HOME: "/home/x" });
    expect(result).toMatch(/Library[\\/]Application Support$/u);
  });

  it("uses XDG_CONFIG_HOME on linux", () => {
    expect(resolveConfigRoot("linux", { XDG_CONFIG_HOME: "/etc/xdg" })).toBe("/etc/xdg");
  });
});

describe("defaultAuthPath", () => {
  it("builds <root>/amechan/<platform>/auth.json", () => {
    const p = defaultAuthPath("netease-music", "win32", {
      AMECHAN_CONFIG_HOME: "C:\\cfg",
    });
    expect(p).toBe(path.join("C:\\cfg", "amechan", "netease-music", "auth.json"));
  });
});

describe("AuthStore", () => {
  it("saves and loads a payload with platform namespace", async () => {
    const store = new AuthStore({
      platform: "netease-music",
      path: path.join(platformDir, "auth.json"),
    });
    expect(store.platform).toBe("netease-music");
    expect(store.path.endsWith("auth.json")).toBe(true);
    expect(store.exists()).toBe(false);

    await store.save({
      platform: "netease-music",
      credentials: { MUSIC_U: "abc", __csrf: "123" },
      savedAt: new Date().toISOString(),
    });
    expect(store.exists()).toBe(true);

    const loaded = await store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.platform).toBe("netease-music");
    expect(loaded!.credentials).toEqual({ MUSIC_U: "abc", __csrf: "123" });
  });

  it("loadSync returns null when file missing", () => {
    const store = new AuthStore({
      platform: "netease-music",
      path: path.join(platformDir, "missing.json"),
    });
    expect(store.loadSync()).toBeNull();
  });

  it("load returns null on corrupt file", async () => {
    const file = path.join(platformDir, "auth.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{not json", "utf-8");
    const store = new AuthStore({ platform: "netease-music", path: file });
    expect(await store.load()).toBeNull();
  });

  it("load returns null when payload has empty credentials", async () => {
    const file = path.join(platformDir, "auth.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({ platform: "netease-music", credentials: {}, savedAt: "now" }),
      "utf-8",
    );
    const store = new AuthStore({ platform: "netease-music", path: file });
    expect(await store.load()).toBeNull();
  });

  it("clear removes the file and is silent when missing", async () => {
    const file = path.join(platformDir, "auth.json");
    const store = new AuthStore({ platform: "netease-music", path: file });
    await store.save({
      platform: "netease-music",
      credentials: { MUSIC_U: "abc" },
      savedAt: new Date().toISOString(),
    });
    await store.clear();
    expect(store.exists()).toBe(false);
    await store.clear(); // 静默
  });
});
