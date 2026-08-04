import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filterPcdnUrls, resolveDownloadUrl, selectBestStream, VideoCodec } from "../src/index.js";
import { startMockFileServer, type MockFileServer } from "./helpers/mock-file.js";

let fileServer: MockFileServer | undefined;
let cleanup: string[] = [];

afterEach(async () => {
  await fileServer?.close();
  fileServer = undefined;
  for (const dir of cleanup) {
    rmSync(dir, { recursive: true, force: true });
  }
  cleanup = [];
});

describe("filterPcdnUrls", () => {
  it("filters out pcdn and mcdn links", () => {
    const urls = [
      "https://upos-sz-mirrorcos.bilivideo.com/video.mp4",
      "https://upos-sz-mcdn.bilivideo.com/video.mp4",
      "https://upos-sz-pcdn.bilivideo.com/video.mp4",
    ];
    const filtered = filterPcdnUrls(urls);
    expect(filtered).toEqual(["https://upos-sz-mirrorcos.bilivideo.com/video.mp4"]);
  });
});

describe("resolveDownloadUrl", () => {
  it("picks the first working URL", async () => {
    fileServer = await startMockFileServer();
    const result = await resolveDownloadUrl(
      [fileServer.url],
      { referer: "https://www.bilibili.com/", userAgent: "test", timeoutSeconds: 5, filterPcdn: true },
    );
    expect(result.fileSize).toBeGreaterThan(0);
  });
});

describe("selectBestStream", () => {
  const streams = [
    { id: 80, codecId: 7, urls: ["https://cdn/80-avc"], raw: {} },
    { id: 80, codecId: 12, urls: ["https://cdn/80-hevc"], raw: {} },
    { id: 64, codecId: 7, urls: ["https://cdn/64-avc"], raw: {} },
  ];

  it("selects highest quality within target", () => {
    const result = selectBestStream(streams, 80);
    expect(result?.id).toBe(80);
    expect(result?.codecId).toBe(12); // HEVC 优先
  });

  it("selects by explicit codec", () => {
    const result = selectBestStream(streams, 80, VideoCodec.AVC);
    expect(result?.codecId).toBe(7);
  });

  it("downgrades quality when target unavailable", () => {
    const result = selectBestStream(streams, 64);
    expect(result?.id).toBe(64);
  });

  it("returns undefined for empty streams", () => {
    expect(selectBestStream([], 80)).toBeUndefined();
  });
});
