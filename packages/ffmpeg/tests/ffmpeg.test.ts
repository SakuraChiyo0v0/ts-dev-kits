import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FfmpegError, createFfmpegClient } from "../src/index.js";
import type { FfmpegProgress } from "../src/index.js";

const client = createFfmpegClient();

interface TestContext {
  directory: string;
  input: string;
}

async function makeTestVideo(): Promise<TestContext> {
  const directory = mkdtempSync(join(tmpdir(), "ffmpeg-sdk-"));
  const input = join(directory, "input.mp4");
  const result = await client.run([
    "-y",
    "-f", "lavfi",
    "-i", "testsrc=duration=2:size=160x120:rate=10",
    "-f", "lavfi",
    "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    input,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create test video: ${result.stderr}`);
  }
  return { directory, input };
}

let cleanup: string[] = [];

function trackCleanup(directory: string): void {
  cleanup.push(directory);
}

afterEach(() => {
  for (const directory of cleanup) {
    rmSync(directory, { recursive: true, force: true });
  }
  cleanup = [];
});

describe("createFfmpegClient", () => {
  it("resolves default binary names", () => {
    const c = createFfmpegClient();
    expect(c.ffmpegPath).toBe("ffmpeg");
    expect(c.ffprobePath).toBe("ffprobe");
  });

  it("accepts explicit binary paths", () => {
    const c = createFfmpegClient({ ffmpegPath: "/usr/bin/ffmpeg", ffprobePath: "/usr/bin/ffprobe" });
    expect(c.ffmpegPath).toBe("/usr/bin/ffmpeg");
    expect(c.ffprobePath).toBe("/usr/bin/ffprobe");
  });

  it("throws NOT_FOUND when an explicit binary path is missing", () => {
    expect(() => createFfmpegClient({ ffmpegPath: "/nonexistent/ffmpeg" })).toThrow(
      FfmpegError,
    );
  });
});

describe("run / runFfprobe", () => {
  it("runs ffmpeg and reports a zero exit code", async () => {
    const ctx = await makeTestVideo();
    trackCleanup(ctx.directory);
    const result = await client.run(["-version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ffmpeg version");
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("reports a nonzero exit code on invalid input", async () => {
    const result = await client.run(["-i", "/nonexistent/file.mp4", "-f", "null", "-"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

describe("probe", () => {
  it("reads metadata of a generated video", async () => {
    const ctx = await makeTestVideo();
    trackCleanup(ctx.directory);
    const info = await client.probe(ctx.input);

    expect(info.formatName).toContain("mp4");
    expect(info.duration).toBeGreaterThan(0);
    expect(info.size).toBeGreaterThan(0);
    expect(info.videoStream).toBeDefined();
    expect(info.videoStream?.width).toBe(160);
    expect(info.videoStream?.height).toBe(120);
    expect(info.audioStream).toBeDefined();
  });

  it("throws PROCESS_ERROR when probing a missing file", async () => {
    const c = createFfmpegClient();
    await expect(c.probe("/nonexistent/file.mp4")).rejects.toMatchObject({
      code: "PROCESS_ERROR",
    });
  });
});

describe("transcode", () => {
  it("converts mp4 to webm and emits progress", async () => {
    const ctx = await makeTestVideo();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "output.webm");
    const progress: FfmpegProgress[] = [];

    const result = await client.transcode({
      input: ctx.input,
      output,
      videoCodec: "libvpx",
      audioCodec: "libopus",
      overwrite: true,
      progressTotalMs: 2000,
      onProgress: (p) => progress.push(p),
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(output)).toBe(true);
    expect(statSync(output).size).toBeGreaterThan(0);
    const info = await client.probe(output);
    expect(info.videoStream).toBeDefined();
    expect(info.videoStream?.codecName).toBe("vp8");
    expect(progress.length).toBeGreaterThan(0);
    const withPercent = progress.find((p) => p.percent !== undefined);
    expect(withPercent).toBeDefined();
  });

  it("respects scale option", async () => {
    const ctx = await makeTestVideo();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "scaled.mp4");

    const result = await client.transcode({
      input: ctx.input,
      output,
      scale: { width: 80 },
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    const info = await client.probe(output);
    expect(info.videoStream?.width).toBe(80);
  });
});

describe("extractAudio", () => {
  it("extracts an audio-only mp3", async () => {
    const ctx = await makeTestVideo();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "audio.mp3");

    const result = await client.extractAudio({ input: ctx.input, output, overwrite: true });

    expect(result.exitCode).toBe(0);
    expect(existsSync(output)).toBe(true);
    const info = await client.probe(output);
    expect(info.audioStream).toBeDefined();
    expect(info.videoStream).toBeUndefined();
  });
});

describe("extractFrame / thumbnail", () => {
  it("extracts a single frame as jpg", async () => {
    const ctx = await makeTestVideo();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "frame.jpg");

    const result = await client.extractFrame({
      input: ctx.input,
      output,
      time: "00:00:01",
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(output)).toBe(true);
    const info = await client.probe(output);
    expect(info.videoStream?.width).toBe(160);
  });

  it("thumbnail defaults to 320px wide", async () => {
    const ctx = await makeTestVideo();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "thumb.jpg");

    const result = await client.thumbnail({ input: ctx.input, output, overwrite: true });

    expect(result.exitCode).toBe(0);
    const info = await client.probe(output);
    expect(info.videoStream?.width).toBe(320);
  });
});

describe("timeout", () => {
  it("throws TIMEOUT when a long-running command exceeds timeout", async () => {
    // `-re` 按实时速率处理输入,让一个 30 秒的测试源在 500ms 内不可能跑完。
    await expect(
      client.run(
        ["-re", "-f", "lavfi", "-i", "testsrc=duration=30", "-f", "null", "-"],
        { timeoutMs: 500 },
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
