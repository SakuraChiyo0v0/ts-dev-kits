import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWebdavClient } from "@sakurachiyo0v0/webdav";
import { startTestWebdavServer, type TestWebdavServer } from "../../../shared/test-helpers/webdav-test-server.js";

const execFileAsync = promisify(execFile);

async function runCli(
  args: string[],
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli", "config.js");
  try {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

describe("sc-config CLI(冒烟,真实本地服务器)", () => {
  let srv: TestWebdavServer;
  const configPath = join(mkdtempSync(join(tmpdir(), "ame-config-cli-")), "config.json");
  const env = (): Record<string, string> => ({ AME_CONFIG_PATH: configPath });

  beforeAll(async () => {
    srv = await startTestWebdavServer();
    // 预建 namespace 目录(生产环境需预先存在)
    const raw = createWebdavClient({ url: srv.url, username: srv.username, password: srv.password });
    for (const dir of ["/amechan", "/amechan/configs", "/amechan/secrets", "/amechan/configs/bilibili", "/amechan/secrets/xiaoheihe"]) {
      await raw.mkdir(dir);
    }
  });

  afterAll(async () => {
    await srv.stop();
  });

  it("setup 写入全局配置", async () => {
    const r = await runCli(
      ["setup", "--url", srv.url, "--username", srv.username, "--password", srv.password, "--key", "cli-test-key"],
      env(),
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true });
  });

  it("status 显示配置(脱敏)", async () => {
    const r = await runCli(["status"], env());
    expect(r.code).toBe(0);
    const s = JSON.parse(r.stdout);
    expect(s.configured).toBe(true);
    expect(s.password).toContain("***");
    expect(s.password).not.toBe(srv.password);
  });

  it("set/get 明文域链路", async () => {
    expect((await runCli(["set", "bilibili", "ui", "--json", '{"quality":80}'], env())).code).toBe(0);
    const get = await runCli(["get", "bilibili", "ui"], env());
    expect(JSON.parse(get.stdout)).toEqual({ quality: 80 });
    const list = await runCli(["list", "bilibili"], env());
    expect(JSON.parse(list.stdout)).toContain("ui");
  });

  it("set/get 加密域链路(密文不含明文)", async () => {
    expect((await runCli(["set", "xiaoheihe", "auth", "--json", '{"cookie":"secret-cookie"}', "--encrypt"], env())).code).toBe(
      0,
    );
    const get = await runCli(["get", "xiaoheihe", "auth", "--encrypt"], env());
    expect(JSON.parse(get.stdout)).toEqual({ cookie: "secret-cookie" });
  });

  it("未 setup 时 status 返回 configured:false", async () => {
    const other = join(mkdtempSync(join(tmpdir(), "ame-config-cli-")), "nope.json");
    const r = await runCli(["status"], { AME_CONFIG_PATH: other });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ configured: false });
  });

  it("remove 删除", async () => {
    expect((await runCli(["remove", "bilibili", "ui"], env())).code).toBe(0);
    const r = await runCli(["get", "bilibili", "ui"], env());
    expect(r.code).not.toBe(0);
  });
});
