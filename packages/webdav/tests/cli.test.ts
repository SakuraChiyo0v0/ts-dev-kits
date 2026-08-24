import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startTestWebdavServer, type TestWebdavServer } from "./helpers/webdav-test-server.js";

const execFileAsync = promisify(execFile);

/** CLI 冒烟:直接以 node 运行编译后的 CLI 脚本(走真实本地服务器) */
async function runCli(
  args: string[],
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli", "webdav.js");
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

describe("amechan-webdav CLI(冒烟,真实本地服务器)", () => {
  let srv: TestWebdavServer;
  const env = (): Record<string, string> => ({
    WEBDAV_URL: srv.url,
    WEBDAV_USERNAME: srv.username,
    WEBDAV_PASSWORD: srv.password,
  });

  beforeAll(async () => {
    srv = await startTestWebdavServer();
  });

  afterAll(async () => {
    await srv.stop();
  });

  it("ping 成功", async () => {
    const r = await runCli(["ping"], env());
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true });
  });

  it("put + list + config-load 链路", async () => {
    expect((await runCli(["mkdir", "/cli-test"], env())).code).toBe(0);
    expect((await runCli(["put", "/cli-test/app.json", "--data", '{"v":1}'], env())).code).toBe(0);
    const list = await runCli(["list", "/cli-test"], env());
    expect(JSON.parse(list.stdout)[0]).toMatchObject({ name: "app.json" });
    const load = await runCli(["config-load", "app.json", "--base-path", "/cli-test"], env());
    expect(JSON.parse(load.stdout)).toEqual({ v: 1 });
  });

  it("get --raw 原样输出", async () => {
    const r = await runCli(["get", "/cli-test/app.json", "--raw"], env());
    expect(r.stdout.trim()).toBe('{"v":1}');
  });

  it("config-save + 备份", async () => {
    expect(
      (await runCli(["config-save", "app.json", "--json", '{"v":2}', "--base-path", "/cli-test"], env()))
        .code,
    ).toBe(0);
    const load = await runCli(["config-load", "app.json", "--base-path", "/cli-test"], env());
    expect(JSON.parse(load.stdout)).toEqual({ v: 2 });
    expect((await runCli(["list", "/cli-test"], env())).stdout).toContain("app.json.bak.1");
  });

  it("认证失败报错", async () => {
    const r = await runCli(["ping"], {
      WEBDAV_URL: srv.url,
      WEBDAV_USERNAME: srv.username,
      WEBDAV_PASSWORD: "bad",
    });
    expect(r.code).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("AUTHENTICATION");
  });
});
