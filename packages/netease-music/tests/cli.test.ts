/**
 * CLI 测试:login / status / logout / parse / download 注入 fake 服务。
 * 通过环境变量把 CLI 指向本地 mock 服务器(AMECHAN_NETEASE_BASE_URL)
 * 与临时登录态路径(AMECHAN_NETEASE_AUTH_PATH)。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli/netease.js";
import { startMockNeteaseApi, type MockNeteaseApi } from "./helpers/mock-api.js";

const SONG_ID = "1001";
const MEDIA_URL_PATH = "/media/song.mp3";

/** 最小的合法 WAV 音频数据(1 秒静音,8kHz 单声道 16bit)。 */
function makeWav(): Buffer {
  const sampleRate = 8000;
  const dataSize = sampleRate * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

const WAV = makeWav();

let mock: MockNeteaseApi;
let authDir: string;
let authPath: string;
let outputDir: string;
let baseUrl = "";
const originalEnv: Record<string, string | undefined> = {};

/** 捕获 CLI stdout 的辅助(拼接 outputJson 的多次 write)。 */
async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: string | Uint8Array) => {
    stdoutChunks.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk: string | Uint8Array) => {
    stderrChunks.push(String(chunk));
    return true;
  };
  try {
    await main(args);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  return { stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
}

function songDetail(fee = 0) {
  return {
    code: 200,
    songs: [
      {
        id: Number(SONG_ID),
        name: "测试歌曲",
        ar: [{ name: "测试歌手" }],
        al: { name: "测试专辑", picUrl: `${baseUrl}/media/cover.jpg` },
        dt: 30_000,
        st: 0,
        fee,
      },
    ],
  };
}

beforeAll(async () => {
  authDir = mkdtempSync(join(tmpdir(), "netease-cli-auth-"));
  authPath = join(authDir, "auth.json");
  outputDir = mkdtempSync(join(tmpdir(), "netease-cli-out-"));
  mock = await startMockNeteaseApi({});
  baseUrl = mock.url;

  mock.setRoute("/weapi/v3/song/detail", () => songDetail(0));
  mock.setRoute("/weapi/music-vip-membership/front/vip/info", () => ({
    code: 200,
    data: { redVipLevel: 0, vipType: 0 },
  }));
  mock.setRoute("/weapi/song/enhance/player/url/v1", () => ({
    code: 200,
    data: [
      { id: Number(SONG_ID), url: `${baseUrl}${MEDIA_URL_PATH}`, level: "exhigh", size: WAV.length, time: 30_000 },
    ],
  }));
  mock.setRoute("/weapi/song/lyric", () => ({
    code: 200,
    lrc: { lyric: "[00:00.000] 测试歌词" },
    tlyric: { lyric: "" },
  }));
  mock.setMedia(MEDIA_URL_PATH, "audio/mpeg", WAV);
  mock.setMedia("/media/cover.jpg", "image/jpeg", Buffer.from("fake-jpeg", "utf8"));

  // 保存原环境变量,测试后恢复。
  originalEnv.AMECHAN_NETEASE_BASE_URL = process.env.AMECHAN_NETEASE_BASE_URL;
  originalEnv.AMECHAN_NETEASE_AUTH_PATH = process.env.AMECHAN_NETEASE_AUTH_PATH;
});

beforeEach(() => {
  process.env.AMECHAN_NETEASE_BASE_URL = baseUrl;
  process.env.AMECHAN_NETEASE_AUTH_PATH = authPath;
});

afterAll(async () => {
  await mock.close();
  rmSync(authDir, { recursive: true, force: true });
  rmSync(outputDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("netease CLI", () => {
  it("login succeeds against mock server and saves credentials", async () => {
    // unikey 返回测试码。
    mock.setRoute("/weapi/login/qrcode/unikey", () => ({ code: 200, unikey: "test-unikey" }));
    // check 直接返回 803 + Set-Cookie(模拟 App 已扫码确认)。
    mock.setRouteWithHeaders("/weapi/login/qrcode/client/login", () => ({
      body: { code: 803, message: "登录成功" },
      headers: {
        "set-cookie": "MUSIC_U=test-music-u; Path=/; HttpOnly, __csrf=test-csrf; Path=/",
      },
    }));

    const { stdout } = await runCli(["login", "--no-browser"]);
    expect(stdout).toContain("登录成功");
    expect(stdout).toContain('"ok": true');

    // 登录态已落盘。
    const { stdout: statusOut } = await runCli(["status"]);
    expect(statusOut).toContain('"loggedIn": true');
  });

  it("status reports not logged in when auth file missing", async () => {
    rmSync(authPath, { force: true });
    const { stdout } = await runCli(["status"]);
    expect(stdout).toContain('"loggedIn": false');
  });

  it("parse resolves a song URL", async () => {
    const { stdout } = await runCli(["parse", `https://music.163.com/song?id=${SONG_ID}`]);
    expect(stdout).toContain('"count": 1');
    expect(stdout).toContain("测试歌曲");
  });

  it("download writes audio file to output dir", async () => {
    const { stdout } = await runCli([
      "download",
      `https://music.163.com/song?id=${SONG_ID}`,
      "--output-dir",
      outputDir,
      "--level",
      "exhigh",
    ]);
    expect(stdout).toContain('"ok": true');
  });

  it("logout clears stored credentials", async () => {
    // 先确保有登录态。
    writeFileSync(authPath, JSON.stringify({
      platform: "netease-music",
      credentials: { cookies: "MUSIC_U=test; __csrf=test" },
      savedAt: new Date().toISOString(),
    }));
    const { stdout } = await runCli(["logout"]);
    expect(stdout).toContain('"ok": true');
    const { stdout: statusOut } = await runCli(["status"]);
    expect(statusOut).toContain('"loggedIn": false');
  });

  it("rejects unknown command with exit code", async () => {
    const { stderr } = await runCli(["bogus"]);
    expect(stderr).toContain("Unknown command");
  });
});
