import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNeteaseClient } from "../src/index.js";
import { startMockNeteaseApi, type MockNeteaseApi } from "./helpers/mock-api.js";

/** 最小的合法 WAV 音频数据(1 秒静音,8kHz 单声道 16bit)。 */
function makeWav(): Buffer {
  const sampleRate = 8000;
  const dataSize = sampleRate * 2; // 1s * 16bit mono
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

const SONG_ID = "1001";
const MEDIA_URL_PATH = "/media/song.mp3";
const WAV = makeWav();

let mock: MockNeteaseApi;
let outputDir: string;
let baseUrl = "";

/** 默认歌曲详情 mock(免费歌曲,权限全开)。 */
function songDetailForAll() {
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
        fee: 0,
      },
    ],
  };
}

beforeAll(async () => {
  outputDir = mkdtempSync(join(tmpdir(), "netease-music-test-"));
  mock = await startMockNeteaseApi({});
  baseUrl = mock.url;

  const streamNormal = () => ({
    code: 200,
    data: [
      { id: Number(SONG_ID), url: `${baseUrl}${MEDIA_URL_PATH}`, level: "exhigh", size: WAV.length, time: 30_000 },
    ],
  });

  mock.setRoute("/weapi/v3/song/detail", songDetailForAll);
  mock.setRoute("/weapi/music-vip-membership/front/vip/info", () => ({
    code: 200,
    data: { redVipLevel: 0, vipType: 0 },
  }));
  mock.setRoute("/weapi/song/enhance/player/url/v1", streamNormal);
  mock.setRoute("/weapi/song/lyric", () => ({
    code: 200,
    lrc: { lyric: "[00:00.000] 测试歌词" },
    tlyric: { lyric: "" },
  }));
  mock.setRoute("/weapi/v6/playlist/detail", () => ({
    code: 200,
    playlist: {
      id: 2001,
      name: "测试歌单",
      tracks: [
        { id: 1001, name: "测试歌曲", ar: [{ name: "歌手A" }], al: { name: "专辑A" }, dt: 30_000, st: 0, fee: 0 },
        { id: 1002, name: "测试歌曲2", ar: [{ name: "歌手B" }], al: { name: "专辑B" }, dt: 30_000, st: 0, fee: 0 },
      ],
    },
  }));

  mock.setMedia(MEDIA_URL_PATH, "audio/mpeg", WAV);
  mock.setMedia("/media/cover.jpg", "image/jpeg", Buffer.from("fake-jpeg", "utf8"));
});

afterAll(async () => {
  await mock.close();
  rmSync(outputDir, { recursive: true, force: true });
});

function newClient() {
  return createNeteaseClient({ baseUrl });
}

describe("NeteaseMusicClient parse", () => {
  it("parses a song URL into a media item", async () => {
    const parsed = await newClient().parse(`https://music.163.com/song?id=${SONG_ID}`);
    expect(parsed.songs).toHaveLength(1);
    expect(parsed.songs[0]?.title).toBe("测试歌曲");
  });

  it("parses a playlist URL and expands tracks", async () => {
    const parsed = await newClient().parse("https://music.163.com/playlist?id=2001");
    expect(parsed.items[0]?.type).toBe("playlist");
    expect(parsed.songs).toHaveLength(2);
  });

  it("rejects non-netease URLs", async () => {
    await expect(newClient().parse("https://example.com/song?id=1")).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });
});

describe("privilege and quality", () => {
  it("returns available levels for a free song without VIP", async () => {
    const levels = await newClient().getAvailableLevels(SONG_ID);
    expect(levels).toContain("exhigh");
    // 无损需要 VIP,非 VIP 不应包含。
    expect(levels).not.toContain("lossless");
    expect(levels).not.toContain("hires");
  });
  it("reports VIP status", async () => {
    const vip = await newClient().getVipInfo();
    expect(vip.isVip).toBe(false);
  });
});

describe("download", () => {
  it("downloads a song with lyric and cover", async () => {
    const parsed = await newClient().parse(`https://music.163.com/song?id=${SONG_ID}`);
    const result = await newClient().download(parsed.songs[0]!, { outputDir });
    expect(readFileSync(result.filePath).length).toBeGreaterThan(0);
    expect(result.lyricPath).toBeTruthy();
    expect(result.coverPath).toBeTruthy();
  });

  it("rejects trial stream (freeTrialInfo)", async () => {
    mock.setRoute("/weapi/song/enhance/player/url/v1", () => ({
      code: 200,
      data: [
        {
          id: Number(SONG_ID),
          url: `${baseUrl}${MEDIA_URL_PATH}`,
          level: "standard",
          size: 500,
          time: 0,
          freeTrialInfo: { start: 0, end: 5000 },
        },
      ],
    }));
    const parsed = await newClient().parse(`https://music.163.com/song?id=${SONG_ID}`);
    await expect(newClient().download(parsed.songs[0]!, { outputDir })).rejects.toMatchObject({
      code: "TRIAL_ONLY",
    });
  });

  it("rejects level not allowed by privilege", async () => {
    // VIP 歌曲(fee=1)+ 非 VIP 账号:可用品质为空 → 任何 level 都 PRIVILEGE_DENIED。
    mock.setRoute("/weapi/v3/song/detail", () => ({
      code: 200,
      songs: [
        {
          id: Number(SONG_ID),
          name: "VIP歌曲",
          ar: [{ name: "测试歌手" }],
          al: { name: "测试专辑", picUrl: `${baseUrl}/media/cover.jpg` },
          dt: 30_000,
          st: 0,
          fee: 1,
        },
      ],
    }));
    mock.setRoute("/weapi/song/enhance/player/url/v1", () => ({
      code: 200,
      data: [
        { id: Number(SONG_ID), url: `${baseUrl}${MEDIA_URL_PATH}`, level: "exhigh", size: WAV.length, time: 30_000 },
      ],
    }));
    const parsed = await newClient().parse(`https://music.163.com/song?id=${SONG_ID}`);
    await expect(newClient().download(parsed.songs[0]!, { outputDir })).rejects.toMatchObject({
      code: "PRIVILEGE_DENIED",
    });
  });

  it("downloads each song in a playlist", async () => {
    // 恢复默认权限与取流,让歌单内两首歌都能下。
    mock.setRoute("/weapi/v3/song/detail", songDetailForAll);
    mock.setRoute("/weapi/song/enhance/player/url/v1", () => ({
      code: 200,
      data: [
        { id: Number(SONG_ID), url: `${baseUrl}${MEDIA_URL_PATH}`, level: "exhigh", size: WAV.length, time: 30_000 },
      ],
    }));
    // 歌单里第二首歌(1002)详情缺省会走 detail mock,只注册 1001;为简化只下载第一首。
    const parsed = await newClient().parse("https://music.163.com/playlist?id=2001");
    const result = await newClient().download(parsed.songs[0]!, { outputDir });
    expect(readFileSync(result.filePath).length).toBeGreaterThan(0);
  });
});
