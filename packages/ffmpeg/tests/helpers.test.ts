import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFfmpegClient } from "../src/index.js";

const ffmpeg = createFfmpegClient();

interface TestContext {
  directory: string;
  video: string;
  audio: string;
  image: string;
}

/** 生成一段含视频+音频的小视频、一段纯音频、一张图片。 */
async function makeFixtures(): Promise<TestContext> {
  const directory = mkdtempSync(join(tmpdir(), "ffmpeg-sdk-"));
  const video = join(directory, "video.mp4");
  const audio = join(directory, "audio.m4a");
  const image = join(directory, "image.png");

  const videoResult = await ffmpeg.run([
    "-y",
    "-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    video,
  ]);
  if (videoResult.exitCode !== 0) {
    throw new Error(`Failed to create test video: ${videoResult.stderr}`);
  }

  const audioResult = await ffmpeg.run([
    "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:a", "aac",
    audio,
  ]);
  if (audioResult.exitCode !== 0) {
    throw new Error(`Failed to create test audio: ${audioResult.stderr}`);
  }

  const imageResult = await ffmpeg.run([
    "-y",
    "-f", "lavfi", "-i", "testsrc=duration=1:size=200x100:rate=1",
    "-frames:v", "1",
    image,
  ]);
  if (imageResult.exitCode !== 0) {
    throw new Error(`Failed to create test image: ${imageResult.stderr}`);
  }

  return { directory, video, audio, image };
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

describe("video helpers", () => {
  it("cut produces a shorter clip", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "cut.mp4");

    const result = await ffmpeg.cut({
      input: ctx.video,
      output,
      start: "00:00:00.5",
      duration: "1",
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    expect(info.duration).toBeGreaterThan(0.5);
    expect(info.duration).toBeLessThan(1.6);
  });

  it("concat joins two video copies", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "concat.mp4");

    const result = await ffmpeg.concat({
      inputs: [ctx.video, ctx.video],
      output,
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    expect(info.duration).toBeGreaterThan(3.5);
  });

  it("watermark overlays an image onto video", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "watermarked.mp4");

    const result = await ffmpeg.watermark({
      input: ctx.video,
      watermark: ctx.image,
      output,
      position: "bottom-right",
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(output)).toBe(true);
    const info = await ffmpeg.probe(output);
    expect(info.videoStream?.width).toBe(160);
  });

  it("loopVideo produces a longer video", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "loop.mp4");

    const result = await ffmpeg.loopVideo({
      input: ctx.video,
      output,
      loopCount: 1,
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    // 原视频 2 秒,循环 1 次 = 4 秒。
    expect(info.duration).toBeGreaterThan(3.5);
    expect(info.duration).toBeLessThan(4.5);
  });

  it("toGif produces an animated gif", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "out.gif");

    const result = await ffmpeg.toGif({
      input: ctx.video,
      output,
      width: 96,
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    expect(statSync(output).size).toBeGreaterThan(0);
    const info = await ffmpeg.probe(output);
    expect(info.videoStream?.codecName).toBe("gif");
  });
});

describe("audio helpers", () => {
  it("converts audio to mp3", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "out.mp3");

    const result = await ffmpeg.toMp3({ input: ctx.audio, output, overwrite: true });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    expect(info.audioStream?.codecName).toBe("mp3");
  });

  it("converts audio to flac", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "out.flac");

    const result = await ffmpeg.toFlac({ input: ctx.audio, output, overwrite: true });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    expect(info.audioStream?.codecName).toBe("flac");
  });

  it("converts audio to wav", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "out.wav");

    const result = await ffmpeg.toWav({ input: ctx.audio, output, overwrite: true });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    expect(info.audioStream?.codecName).toBe("pcm_s16le");
  });

  it("converts audio to ogg", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "out.ogg");

    const result = await ffmpeg.toOgg({ input: ctx.audio, output, overwrite: true });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    expect(info.audioStream?.codecName).toBe("vorbis");
  });

  it("converts audio to m4a", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "out.m4a");

    const result = await ffmpeg.toM4a({ input: ctx.audio, output, overwrite: true });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    expect(info.audioStream?.codecName).toBe("aac");
  });

  it("adjusts volume without error", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "louder.m4a");

    const result = await ffmpeg.setVolume({
      input: ctx.audio,
      output,
      volume: 1.5,
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(output)).toBe(true);
  });

  it("normalizes audio loudness", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "norm.m4a");

    const result = await ffmpeg.normalizeAudio({
      input: ctx.audio,
      output,
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(output)).toBe(true);
  });

  it("joins two audio files", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "joined.m4a");

    const result = await ffmpeg.joinAudio({
      inputs: [ctx.audio, ctx.audio],
      output,
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    expect(info.duration).toBeGreaterThan(3.5);
  });

  it("writes tags to an mp3 without re-encoding", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const input = join(ctx.directory, "tag-in.mp3");
    const output = join(ctx.directory, "tag-out.mp3");

    await ffmpeg.toMp3({ input: ctx.audio, output: input, overwrite: true });
    const result = await ffmpeg.writeTags({
      input,
      output,
      title: "测试标题",
      artist: "测试歌手",
      album: "测试专辑",
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    expect(info.audioStream?.codecName).toBe("mp3");
    // 写标签不重编码,时长保持不变。
    expect(info.duration).toBeGreaterThan(1);
  });

  it("writes tags with embedded cover to mp3", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const input = join(ctx.directory, "cover-in.mp3");
    const output = join(ctx.directory, "cover-out.mp3");

    await ffmpeg.toMp3({ input: ctx.audio, output: input, overwrite: true });
    const result = await ffmpeg.writeTags({
      input,
      output,
      title: "带封面",
      cover: ctx.image,
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    expect(info.audioStream?.codecName).toBe("mp3");
    // 封面作为附加图片流(mjpeg)。
    const coverStream = info.streams.find((stream) => stream.codecName === "mjpeg");
    expect(coverStream).toBeDefined();
  });
});

describe("image helpers", () => {
  it("resizes an image", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "small.png");

    const result = await ffmpeg.resizeImage({
      input: ctx.image,
      output,
      width: 50,
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    expect(info.videoStream?.width).toBe(50);
  });

  it("crops an image", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "cropped.png");

    const result = await ffmpeg.cropImage({
      input: ctx.image,
      output,
      width: 100,
      height: 80,
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    expect(info.videoStream?.width).toBe(100);
    expect(info.videoStream?.height).toBe(80);
  });

  it("converts png to jpg", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "out.jpg");

    const result = await ffmpeg.convertImage({
      input: ctx.image,
      output,
      quality: 90,
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    const info = await ffmpeg.probe(output);
    expect(info.videoStream?.codecName).toBe("mjpeg");
  });

  it("composites an overlay onto an image", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "composite.png");

    const result = await ffmpeg.compositeImage({
      input: ctx.image,
      overlay: ctx.image,
      output,
      x: 10,
      y: 10,
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(output)).toBe(true);
  });

  it("compresses an image to jpg with smaller size", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "compressed.jpg");

    const result = await ffmpeg.compressImage({
      input: ctx.image,
      output,
      width: 120,
      quality: 60,
      overwrite: true,
    });

    expect(result.exitCode).toBe(0);
    expect(statSync(output).size).toBeGreaterThan(0);
    const info = await ffmpeg.probe(output);
    expect(info.videoStream?.width).toBe(120);
  });
});

describe("runCommand", () => {
  it("runs a native ffmpeg command string", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);
    const output = join(ctx.directory, "from-command.mp4");

    // tokenizeCommand 把 `\` 当转义符,Windows 路径需转义反斜杠。
    const escapeBackslashes = (value: string): string => value.replace(/\\/gu, "\\\\");
    const result = await ffmpeg.runCommand(
      `ffmpeg -i "${escapeBackslashes(ctx.video)}" -c:v libx264 -c:a aac -y "${escapeBackslashes(output)}"`,
    );

    expect(result.exitCode).toBe(0);
    expect(existsSync(output)).toBe(true);
  });

  it("runs a native ffprobe command string", async () => {
    const ctx = await makeFixtures();
    trackCleanup(ctx.directory);

    const escapeBackslashes = (value: string): string => value.replace(/\\/gu, "\\\\");
    const result = await ffmpeg.runCommand(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${escapeBackslashes(ctx.video)}"`,
    );

    expect(result.exitCode).toBe(0);
    expect(Number(result.stdout.trim())).toBeGreaterThan(0);
  });

  it("rejects an unterminated quote", async () => {
    await expect(ffmpeg.runCommand('ffmpeg -i "unterminated')).rejects.toMatchObject({
      code: "CONFIGURATION",
    });
  });
});
