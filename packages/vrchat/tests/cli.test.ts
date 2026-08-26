/**
 * CLI 冒烟测试:验证子命令真实执行链路(parseArgs → client → mock API → 输出)。
 * 通过环境变量注入 baseUrl 与 authPath,不触发 isDirectRun(直接 import main)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockVrchatServer } from "./helpers/mock-vrchat-server.js";
import { main } from "../src/cli/vrchat.js";

let server: MockVrchatServer | undefined;
let dir: string | undefined;
let authPath: string | undefined;

beforeEach(async () => {
  server = new MockVrchatServer();
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "vrchat-cli-"));
  authPath = path.join(dir, "auth.json");
  writeFileSync(
    authPath,
    JSON.stringify({
      platform: "vrchat",
      credentials: { authCookie: "auth=mock-auth-cookie-123" },
      savedAt: "2026-01-01T00:00:00.000Z",
    }),
    "utf8",
  );
  // 注入环境变量(与 CLI 的 envBaseUrl / envAuthPath 读取一致)。
  vi.stubEnv("AMECHAN_VRCHAT_BASE_URL", server.baseUrl);
  vi.stubEnv("AMECHAN_VRCHAT_AUTH_PATH", authPath);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await server?.close();
  server = undefined;
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

describe("sc-vrchat CLI 子命令", () => {
  it("system time(无需登录)", async () => {
    const out = await captureOutput(() => main(["system", "time"]));
    const parsed = JSON.parse(out) as string;
    expect(typeof parsed).toBe("string");
  });

  it("users get 返回用户", async () => {
    const out = await captureOutput(() =>
      main(["users", "get", "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]),
    );
    const parsed = JSON.parse(out) as { username: string };
    expect(parsed.username).toBe("alice");
  });

  it("friends list 返回好友", async () => {
    const out = await captureOutput(() => main(["friends", "list"]));
    const parsed = JSON.parse(out) as { count: number; friends: unknown[] };
    expect(parsed.count).toBeGreaterThan(0);
  });

  it("worlds search 返回世界", async () => {
    const out = await captureOutput(() => main(["worlds", "search", "mock"]));
    const parsed = JSON.parse(out) as { count: number };
    expect(parsed.count).toBeGreaterThan(0);
  });

  it("notifications accept 写操作", async () => {
    const out = await captureOutput(() =>
      main(["notifications", "accept", "ntf_00000000-0000-0000-0000-000000000000"]),
    );
    const parsed = JSON.parse(out) as { ok: boolean; type: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.type).toBe("friendRequest");
  });

  it("notifications see 标记已读", async () => {
    const out = await captureOutput(() =>
      main(["notifications", "see", "ntf_00000000-0000-0000-0000-000000000000"]),
    );
    const parsed = JSON.parse(out) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it("groups member 返回成员", async () => {
    const out = await captureOutput(() =>
      main(["groups", "member", "grp_00000000-0000-0000-0000-000000000000", "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee"]),
    );
    const parsed = JSON.parse(out) as { username: string };
    expect(parsed.username).toBe("bob");
  });

  it("files create-image 创建图片文件", async () => {
    const out = await captureOutput(() =>
      main(["files", "create-image", "icon.png", "image/png", ".png"]),
    );
    const parsed = JSON.parse(out) as { name: string };
    expect(parsed.name).toBe("icon.png");
  });

  it("messages list 快捷消息", async () => {
    const out = await captureOutput(() =>
      main(["messages", "list", "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "message"]),
    );
    const parsed = JSON.parse(out) as { count: number };
    expect(parsed.count).toBeGreaterThan(0);
  });

  it("未知命令输出错误", async () => {
    const err = await captureError(() => main(["nonexistent"]));
    expect(err).toContain("Unknown command");
  });
});

/** 捕获 main() 的 outputJson/outputText 输出(stdout 方向)。 */
async function captureOutput(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
  try {
    await fn();
  } finally {
    spy.mockRestore();
    void originalWrite;
  }
  return chunks.join("");
}

/** 捕获 stderr 输出。 */
async function captureError(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
}
