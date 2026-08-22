import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { AuthStore, defaultAuthPath, resolveConfigRoot } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "bili-auth-"));
  tempDirs.push(dir);
  return dir;
}

const sampleData = {
  cookies: "SESSDATA=abc; bili_jct=xyz; DedeUserID=123",
  refreshToken: "token-1",
  savedAt: new Date().toISOString(),
};

describe("resolveConfigRoot", () => {
  it("优先使用 AMECHAN_CONFIG_HOME", () => {
    expect(resolveConfigRoot("linux", { AMECHAN_CONFIG_HOME: "C:\\custom" })).toBe("C:\\custom");
  });

  it("win32 使用 APPDATA", () => {
    expect(resolveConfigRoot("win32", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" })).toBe(
      "C:\\Users\\me\\AppData\\Roaming",
    );
  });

  it("win32 无 APPDATA 时回退家目录 .config", () => {
    expect(resolveConfigRoot("win32", {})).toBe(path.join(homedir(), ".config"));
  });

  it("darwin 使用 Library/Application Support", () => {
    expect(resolveConfigRoot("darwin", {})).toBe(
      path.join(homedir(), "Library", "Application Support"),
    );
  });

  it("linux 使用 XDG_CONFIG_HOME,缺省 ~/.config", () => {
    expect(resolveConfigRoot("linux", { XDG_CONFIG_HOME: "/x/config" })).toBe("/x/config");
    expect(resolveConfigRoot("linux", {})).toBe(path.join(homedir(), ".config"));
  });
});

describe("defaultAuthPath", () => {
  it("拼接 amechan/bilibili/auth.json", () => {
    expect(defaultAuthPath("win32", { APPDATA: "C:\\AppData" })).toBe(
      "C:\\AppData\\amechan\\bilibili\\auth.json",
    );
  });
});

describe("AuthStore", () => {
  it("save/load/loadSync 往返一致", async () => {
    const dir = await tempDir();
    const store = new AuthStore(path.join(dir, "auth.json"));
    expect(store.exists()).toBe(false);
    expect(await store.load()).toBeNull();
    await store.save(sampleData);
    expect(store.exists()).toBe(true);
    expect(await store.load()).toEqual(sampleData);
    expect(store.loadSync()).toEqual(sampleData);
  });

  it("clear 删除文件,重复 clear 静默成功", async () => {
    const dir = await tempDir();
    const store = new AuthStore(path.join(dir, "auth.json"));
    await store.save(sampleData);
    await store.clear();
    expect(store.exists()).toBe(false);
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it("损坏的 JSON 视为未登录", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "auth.json");
    await fs.writeFile(file, "{ not json", "utf-8");
    const store = new AuthStore(file);
    expect(await store.load()).toBeNull();
  });

  it("缺少 cookies/refreshToken 视为未登录", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "auth.json");
    await fs.writeFile(file, JSON.stringify({ cookies: "", refreshToken: "x" }), "utf-8");
    const store = new AuthStore(file);
    expect(await store.load()).toBeNull();
  });

  it("文件权限为 600(尽力而为)", async () => {
    const dir = await tempDir();
    const store = new AuthStore(path.join(dir, "auth.json"));
    await store.save(sampleData);
    const stat = await fs.stat(store.path);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });
});
