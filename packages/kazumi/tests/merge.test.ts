/**
 * 真实 ffmpeg 合并验证 —— 用真 ffmpeg 把本地 m3u8 合并成 mp4。
 * 跳过条件:系统无 ffmpeg 时跳过(测试环境用真实 ffmpeg 产物验证)。
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseM3u8, buildLocalM3u8, extractUniqueKeys } from "../src/stream/m3u8.js";
import { createFfmpegClient } from "@sakurachiyo0v0/ffmpeg";

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeFfmpeg = hasFfmpeg() ? describe : describe.skip;

describeFfmpeg("真实 ffmpeg 合并", () => {
  it("分片 → 本地 m3u8 → mp4(流复制)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kazumi-merge-"));
    try {
      // 用 ffmpeg 生成两个真实 TS 分片(测试源数据)
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-f", "lavfi",
          "-i", "testsrc=duration=1:size=128x72:rate=10",
          "-c:v", "libx264",
          "-f", "mpegts",
          join(dir, "seg_00000.ts"),
        ],
        { stdio: "ignore" },
      );
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-f", "lavfi",
          "-i", "testsrc=duration=1:size=128x72:rate=10",
          "-c:v", "libx264",
          "-f", "mpegts",
          join(dir, "seg_00001.ts"),
        ],
        { stdio: "ignore" },
      );

      const playlist = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:2",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXTINF:1.000,",
        "/seg_00000.ts",
        "#EXTINF:1.000,",
        "/seg_00001.ts",
        "#EXT-X-ENDLIST",
      ].join("\n");
      const media = parseM3u8(playlist).media!;
      expect(media.segments.length).toBe(2);
      expect(extractUniqueKeys(media)).toEqual([]);

      const local = buildLocalM3u8(media, {
        segmentNames: ["seg_00000.ts", "seg_00001.ts"],
        keyUriToLocal: new Map(),
      });
      const m3u8Path = join(dir, "playlist.m3u8");
      writeFileSync(m3u8Path, local, "utf-8");

      const ffmpeg = createFfmpegClient();
      const output = join(dir, "out.mp4");
      const result = await ffmpeg.run(
        [
          "-y",
          "-allowed_extensions",
          "ALL",
          "-i",
          m3u8Path,
          "-c",
          "copy",
          "-bsf:a",
          "aac_adtstoasc",
          output,
        ],
        { timeoutMs: 60_000 },
      );
      expect(result.exitCode).toBe(0);
      expect(existsSync(output)).toBe(true);
      expect(require("node:fs").statSync(output).size).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
