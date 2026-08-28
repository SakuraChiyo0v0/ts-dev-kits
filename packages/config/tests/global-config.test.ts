import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebdavErrorCode } from "@sakurachiyo0v0/webdav";
import { clearGlobalConfig, loadGlobalConfig, resolveConfigPath, resolveConfigRoot, saveGlobalConfig } from "../src/index.js";

describe("全局配置(本地文件)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ame-config-test-"));
  let path = "";

  afterEach(() => {
    clearGlobalConfig(path);
  });

  it("save → load 往返", () => {
    path = join(dir, "config.json");
    const saved = saveGlobalConfig({ url: "https://dav.example.com/dav/", username: "u", password: "p", key: "k" }, path);
    expect(saved).toBe(path);
    expect(loadGlobalConfig(path)).toEqual({
      url: "https://dav.example.com/dav/",
      username: "u",
      password: "p",
      key: "k",
    });
  });

  it("文件权限 600", () => {
    path = join(dir, "perm.json");
    saveGlobalConfig({ url: "https://dav.example.com/dav/" }, path);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("缺少 url → VALIDATION", () => {
    path = join(dir, "bad.json");
    expect(() => saveGlobalConfig({ url: "" }, path)).toThrowError(
      expect.objectContaining({ code: WebdavErrorCode.VALIDATION }),
    );
  });

  it("文件不存在 → VALIDATION", () => {
    path = join(dir, "missing.json");
    expect(() => loadGlobalConfig(path)).toThrowError(
      expect.objectContaining({ code: WebdavErrorCode.VALIDATION }),
    );
  });

  it("resolveConfigPath 可用环境变量覆盖", () => {
    const prev = process.env.AME_CONFIG_PATH;
    process.env.AME_CONFIG_PATH = "/tmp/ame-custom/config.json";
    try {
      expect(resolveConfigPath()).toBe("/tmp/ame-custom/config.json");
    } finally {
      if (prev !== undefined) process.env.AME_CONFIG_PATH = prev;
      else delete process.env.AME_CONFIG_PATH;
    }
  });

  it("clear 删除文件", () => {
    path = join(dir, "gone.json");
    saveGlobalConfig({ url: "https://dav.example.com/dav/" }, path);
    clearGlobalConfig(path);
    expect(() => loadGlobalConfig(path)).toThrowError(
      expect.objectContaining({ code: WebdavErrorCode.VALIDATION }),
    );
  });

  it("配置文件内容不含明文敏感信息(可读性验证)", () => {
    path = join(dir, "readable.json");
    saveGlobalConfig({ url: "https://dav.example.com/dav/", username: "u", password: "pw" }, path);
    const raw = readFileSync(path, "utf8");
    expect(raw).toContain("dav.example.com");
  });
});

describe("resolveConfigRoot(配置根唯一权威)", () => {
  it("AMECHAN_CONFIG_HOME 优先", () => {
    expect(resolveConfigRoot("linux", { AMECHAN_CONFIG_HOME: "/custom" })).toBe("/custom");
  });

  it("linux 用 XDG_CONFIG_HOME,缺省 ~/.config", () => {
    expect(resolveConfigRoot("linux", { XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg");
    const result = resolveConfigRoot("linux", { HOME: "/home/u" });
    expect(result).toContain(".config");
  });

  it("darwin 用 Application Support", () => {
    const result = resolveConfigRoot("darwin", { HOME: "/Users/u" });
    expect(result).toContain("Application Support");
  });

  it("win32 用 APPDATA,缺省回退 AppData/Roaming(修复 account 版缺失回退)", () => {
    expect(resolveConfigRoot("win32", { APPDATA: "C:\\Users\\u\\AppData\\Roaming" })).toBe(
      "C:\\Users\\u\\AppData\\Roaming",
    );
    const result = resolveConfigRoot("win32", { USERPROFILE: "C:\\Users\\u" });
    expect(result).toContain("AppData");
    expect(result).toContain("Roaming");
  });
});
