import { createLogger } from "@sakurachiyo0v0/logger";
import { FfmpegError } from "./errors.js";
import { createRunner } from "./runner.js";
import type {
  CompositeImageOptions,
  CompressImageOptions,
  ConcatOptions,
  ConvertAudioOptions,
  ConvertImageOptions,
  CropImageOptions,
  CutOptions,
  ExtractAudioOptions,
  ExtractFrameOptions,
  FfmpegClient,
  FfmpegOptions,
  FfmpegProgress,
  JoinAudioOptions,
  LoopVideoOptions,
  NormalizeAudioOptions,
  ProbeResult,
  ProbeStream,
  ResizeImageOptions,
  RunResult,
  ScaleSpec,
  SetVolumeOptions,
  ThumbnailOptions,
  ToGifOptions,
  TranscodeOptions,
  WatermarkOptions,
  WriteTagsOptions,
} from "./types.js";

/** 把 ffprobe JSON 输出规范化为 ProbeResult。 */
export function parseProbeJson(raw: unknown): ProbeResult {
  if (typeof raw !== "object" || raw === null) {
    throw new FfmpegError("UNKNOWN", "ffprobe returned non-object JSON");
  }
  const value = raw as {
    format?: Record<string, unknown>;
    streams?: Array<Record<string, unknown>>;
  };
  const format = value.format ?? {};

  const streams: ProbeStream[] = (value.streams ?? []).map((stream) => {
    const result: ProbeStream = {
      index: Number(stream.index ?? 0),
      codecType: String(stream.codec_type ?? ""),
      codecName: String(stream.codec_name ?? ""),
      raw: stream,
    };
    if (typeof stream.codec_long_name === "string") {
      result.codecLongName = stream.codec_long_name;
    }
    if (typeof stream.width === "number") {
      result.width = stream.width;
    }
    if (typeof stream.height === "number") {
      result.height = stream.height;
    }
    if (typeof stream.duration === "number") {
      result.duration = stream.duration;
    }
    if (typeof stream.bit_rate === "number") {
      result.bitRate = stream.bit_rate;
    }
    if (typeof stream.sample_rate === "number") {
      result.sampleRate = stream.sample_rate;
    }
    if (typeof stream.channels === "number") {
      result.channels = stream.channels;
    }
    const tags = stream.tags as { language?: unknown } | undefined;
    if (typeof tags?.language === "string") {
      result.language = tags.language;
    }
    return result;
  });

  const result: ProbeResult = {
    formatName: String(format.format_name ?? ""),
    duration: typeof format.duration === "number" ? format.duration : Number(format.duration ?? 0),
    size: typeof format.size === "number" ? format.size : Number(format.size ?? 0),
    streams,
    raw,
  };
  if (typeof format.format_long_name === "string") {
    result.formatLongName = format.format_long_name;
  }
  if (typeof format.bit_rate === "number") {
    result.bitRate = format.bit_rate;
  }
  const videoStream = streams.find((stream) => stream.codecType === "video");
  const audioStream = streams.find((stream) => stream.codecType === "audio");
  if (videoStream !== undefined) {
    result.videoStream = videoStream;
  }
  if (audioStream !== undefined) {
    result.audioStream = audioStream;
  }
  return result;
}

function scaleArgs(scale: ScaleSpec | undefined): string[] {
  if (scale === undefined) {
    return [];
  }
  const width = scale.width ?? -2;
  const height = scale.height ?? -2;
  return ["-vf", `scale=${width}:${height}`];
}

function requireInput(input: string, label: string): void {
  if (!input.trim()) {
    throw new FfmpegError("CONFIGURATION", `${label} is required`);
  }
}

function yArgs(overwrite: boolean | undefined): string[] {
  return overwrite === true ? ["-y"] : [];
}

/** 只保留已定义的可选运行参数,避免给 runner 传 undefined。 */
function runOptions(
  options: {
    onProgress?: ((progress: FfmpegProgress) => void) | undefined;
    progressTotalMs?: number | undefined;
    timeoutMs?: number | undefined;
  },
): Omit<import("./types.js").RunOptions, "args"> {
  const result: Omit<import("./types.js").RunOptions, "args"> = {};
  if (options.onProgress !== undefined) {
    result.onProgress = options.onProgress;
  }
  if (options.progressTotalMs !== undefined) {
    result.progressTotalMs = options.progressTotalMs;
  }
  if (options.timeoutMs !== undefined) {
    result.timeoutMs = options.timeoutMs;
  }
  return result;
}

/** 把一条命令行字符串拆成参数数组,支持单双引号与反斜杠转义。 */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current !== "") {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) {
    current += "\\";
  }
  if (quote !== undefined) {
    throw new FfmpegError("CONFIGURATION", "Unterminated quote in command");
  }
  if (current !== "") {
    tokens.push(current);
  }
  return tokens;
}

/** 根据输出扩展名推断 JPEG 类输出。 */
function isJpegFamily(output: string): boolean {
  return /\.jpe?g$/iu.test(output);
}

/** 根据输出扩展名推断 WebP 输出。 */
function isWebp(output: string): boolean {
  return /\.webp$/iu.test(output);
}

function qualityArgs(output: string, quality: number | undefined): string[] {
  if (quality === undefined) {
    return [];
  }
  if (isWebp(output)) {
    return ["-quality", String(quality)];
  }
  if (isJpegFamily(output)) {
    // JPEG -q:v 2..31,数值越小质量越高。把用户友好的 1-100 映射过去。
    const qscale = Math.round(31 - (Math.min(100, Math.max(1, quality)) / 100) * 29);
    return ["-q:v", String(qscale)];
  }
  return [];
}

export function createFfmpegClient(options: FfmpegOptions = {}): FfmpegClient {
  const logger = createLogger({ namespace: "ffmpeg" }).child("client");
  const runner = createRunner(options);
  logger.debug("ffmpeg client created", {
    ffmpegPath: runner.ffmpegPath,
    ffprobePath: runner.ffprobePath,
  });

  async function probe(input: string): Promise<ProbeResult> {
    requireInput(input, "input");
    logger.debug("probing media", { input });
    const result = await runner.runFfprobe([
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      input,
    ]);
    if (result.exitCode !== 0) {
      logger.error("ffprobe failed", { input, exitCode: result.exitCode });
      throw new FfmpegError("PROCESS_ERROR", `ffprobe failed with exit code ${String(result.exitCode)}`, {
        ...(result.exitCode !== null ? { exitCode: result.exitCode } : {}),
        ...(result.stderr !== "" ? { stderr: result.stderr } : {}),
      });
    }
    try {
      const parsed = parseProbeJson(JSON.parse(result.stdout) as unknown);
      logger.debug("media probed", {
        input,
        durationMs: parsed.duration,
        format: parsed.formatName,
      });
      return parsed;
    } catch (error) {
      if (error instanceof FfmpegError) {
        throw error;
      }
      logger.error("failed to parse ffprobe output", { input, error });
      throw new FfmpegError("UNKNOWN", "Failed to parse ffprobe output", { cause: error });
    }
  }

  async function transcode(options: TranscodeOptions): Promise<RunResult> {
    return logger.timed("ffmpeg.transcode", async () => {
      requireInput(options.input, "input");
      requireInput(options.output, "output");
      const args = [
        "-i", options.input,
        ...(options.videoCodec ? ["-c:v", options.videoCodec] : []),
        ...(options.audioCodec ? ["-c:a", options.audioCodec] : []),
        ...(options.videoBitrate ? ["-b:v", options.videoBitrate] : []),
        ...(options.audioBitrate ? ["-b:a", options.audioBitrate] : []),
        ...scaleArgs(options.scale),
        "-progress", "pipe:1",
        "-nostats",
        ...yArgs(options.overwrite),
        options.output,
      ];
      logger.info("transcoding", { input: options.input, output: options.output });
      return runner.run(args, runOptions(options));
    });
  }

  async function extractAudio(options: ExtractAudioOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    const args = [
      "-i", options.input,
      "-vn",
      "-c:a", options.audioCodec ?? "libmp3lame",
      "-b:a", options.audioBitrate ?? "192k",
      "-progress", "pipe:1",
      "-nostats",
      ...yArgs(options.overwrite),
      options.output,
    ];
    logger.info("extracting audio", { input: options.input, output: options.output });
    return runner.run(args, runOptions(options));
  }

  async function extractFrame(options: ExtractFrameOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    const args = [
      "-ss", options.time ?? "00:00:00",
      "-i", options.input,
      "-frames:v", "1",
      ...scaleArgs(options.scale),
      "-progress", "pipe:1",
      "-nostats",
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  async function thumbnail(options: ThumbnailOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    return extractFrame({
      input: options.input,
      output: options.output,
      time: options.time ?? "00:00:01",
      scale: { width: options.width ?? 320 },
      ...(options.overwrite !== undefined ? { overwrite: options.overwrite } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
      ...(options.progressTotalMs !== undefined ? { progressTotalMs: options.progressTotalMs } : {}),
    });
  }

  // ---------- 视频 ----------

  async function cut(options: CutOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    if (options.end !== undefined && options.duration !== undefined) {
      throw new FfmpegError("CONFIGURATION", "end and duration cannot both be set");
    }
    const args = [
      ...(options.start !== undefined ? ["-ss", options.start] : []),
      "-i", options.input,
      ...(options.duration !== undefined ? ["-t", options.duration] : []),
      ...(options.end !== undefined ? ["-to", options.end] : []),
      ...(options.copy === true
        ? ["-c", "copy"]
        : [
            ...(options.videoCodec ? ["-c:v", options.videoCodec] : []),
            ...(options.audioCodec ? ["-c:a", options.audioCodec] : []),
          ]),
      "-progress", "pipe:1",
      "-nostats",
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  async function concat(options: ConcatOptions): Promise<RunResult> {
    if (options.inputs.length === 0) {
      throw new FfmpegError("CONFIGURATION", "at least one input is required");
    }
    requireInput(options.output, "output");

    if (options.copy === true) {
      // 流复制模式:用 concat demuxer,需要临时列表文件。
      const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const directory = mkdtempSync(join(tmpdir(), "ffmpeg-concat-"));
      const listPath = join(directory, "list.txt");
      const lines = options.inputs
        .map((input) => `file '${input.replaceAll("'", "'\\''")}'`)
        .join("\n");
      writeFileSync(listPath, `${lines}\n`);
      try {
        const args = [
          "-f", "concat",
          "-safe", "0",
          "-i", listPath,
          "-c", "copy",
          ...yArgs(options.overwrite),
          options.output,
        ];
        return await runner.run(args, runOptions(options));
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }

    const inputs = options.inputs.flatMap((input) => ["-i", input]);
    const streamSpec = options.inputs.length > 0
      ? `[0:v][0:a][1:v][1:a]concat=n=${options.inputs.length}:v=1:a=1[outv][outa]`
      : "";
    const args = [
      ...inputs,
      "-filter_complex", streamSpec,
      "-map", "[outv]",
      "-map", "[outa]",
      ...(options.videoCodec ? ["-c:v", options.videoCodec] : []),
      ...(options.audioCodec ? ["-c:a", options.audioCodec] : []),
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  function watermarkPosition(
    position: NonNullable<WatermarkOptions["position"]> | undefined,
  ): string {
    switch (position) {
      case "top-right":
        return "W-w-10:10";
      case "bottom-left":
        return "10:H-h-10";
      case "bottom-right":
        return "W-w-10:H-h-10";
      case "center":
        return "(W-w)/2:(H-h)/2";
      case "top-left":
      default:
        return "10:10";
    }
  }

  async function watermark(options: WatermarkOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.watermark, "watermark");
    requireInput(options.output, "output");
    const opacity = options.opacity ?? 1;
    const position = watermarkPosition(options.position);
    const filter = `[1]format=rgba,colorchannelmixer=aa=${opacity}[wm];[0][wm]overlay=${position}`;
    const args = [
      "-i", options.input,
      "-i", options.watermark,
      "-filter_complex", filter,
      "-progress", "pipe:1",
      "-nostats",
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  async function loopVideo(options: LoopVideoOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    const loopCount = options.loopCount ?? -1;
    const args = [
      "-stream_loop", String(loopCount),
      "-i", options.input,
      ...(options.outputDuration !== undefined ? ["-t", options.outputDuration] : []),
      "-progress", "pipe:1",
      "-nostats",
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  async function toGif(options: ToGifOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    const fps = options.fps ?? 10;
    const width = options.width ?? 320;
    const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
    const args = [
      ...(options.start !== undefined ? ["-ss", options.start] : []),
      "-i", options.input,
      ...(options.duration !== undefined ? ["-t", options.duration] : []),
      "-vf", filter,
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  // ---------- 音频 ----------

  async function convertAudio(options: ConvertAudioOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    const args = [
      "-i", options.input,
      "-vn",
      ...(options.audioCodec ? ["-c:a", options.audioCodec] : []),
      ...(options.audioBitrate ? ["-b:a", options.audioBitrate] : []),
      ...(options.channels !== undefined ? ["-ac", String(options.channels)] : []),
      ...(options.sampleRate !== undefined ? ["-ar", String(options.sampleRate)] : []),
      "-progress", "pipe:1",
      "-nostats",
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  function toMp3(options: ConvertAudioOptions): Promise<RunResult> {
    return convertAudio({
      ...options,
      ...(options.audioCodec === undefined ? { audioCodec: "libmp3lame" } : {}),
      ...(options.audioBitrate === undefined ? { audioBitrate: "192k" } : {}),
    });
  }

  function toFlac(options: ConvertAudioOptions): Promise<RunResult> {
    return convertAudio({
      ...options,
      ...(options.audioCodec === undefined ? { audioCodec: "flac" } : {}),
    });
  }

  function toWav(options: ConvertAudioOptions): Promise<RunResult> {
    return convertAudio({
      ...options,
      ...(options.audioCodec === undefined ? { audioCodec: "pcm_s16le" } : {}),
    });
  }

  function toOgg(options: ConvertAudioOptions): Promise<RunResult> {
    return convertAudio({
      ...options,
      ...(options.audioCodec === undefined ? { audioCodec: "libvorbis" } : {}),
      ...(options.audioBitrate === undefined ? { audioBitrate: "192k" } : {}),
    });
  }

  function toM4a(options: ConvertAudioOptions): Promise<RunResult> {
    return convertAudio({
      ...options,
      ...(options.audioCodec === undefined ? { audioCodec: "aac" } : {}),
      ...(options.audioBitrate === undefined ? { audioBitrate: "192k" } : {}),
    });
  }

  async function setVolume(options: SetVolumeOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    const args = [
      "-i", options.input,
      "-af", `volume=${String(options.volume)}`,
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  async function normalizeAudio(options: NormalizeAudioOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    const loudnessTarget = options.loudnessTarget ?? -16;
    const truePeak = options.truePeak ?? -1.5;
    const args = [
      "-i", options.input,
      "-af", `loudnorm=I=${loudnessTarget}:TP=${truePeak}:LRA=11`,
      "-progress", "pipe:1",
      "-nostats",
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  async function joinAudio(options: JoinAudioOptions): Promise<RunResult> {
    if (options.inputs.length === 0) {
      throw new FfmpegError("CONFIGURATION", "at least one input is required");
    }
    requireInput(options.output, "output");
    const inputs = options.inputs.flatMap((input) => ["-i", input]);
    const concatFilter = options.inputs.length === 1
      ? "[0:a]anull[outa]"
      : options.inputs.map((_, index) => `[${index}:a]`).join("") +
        `concat=n=${options.inputs.length}:v=0:a=1[outa]`;
    const args = [
      ...inputs,
      "-filter_complex", concatFilter,
      "-map", "[outa]",
      ...(options.audioCodec ? ["-c:a", options.audioCodec] : []),
      ...(options.audioBitrate ? ["-b:a", options.audioBitrate] : []),
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  // ---------- 图片 ----------

  async function resizeImage(options: ResizeImageOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    const width = options.width ?? -2;
    const height = options.height ?? -2;
    const args = [
      "-i", options.input,
      "-vf", `scale=${width}:${height}`,
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  async function cropImage(options: CropImageOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    const x = options.x ?? "(in_w-out_w)/2";
    const y = options.y ?? "(in_h-out_h)/2";
    const args = [
      "-i", options.input,
      "-vf", `crop=${options.width}:${options.height}:${x}:${y}`,
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  async function convertImage(options: ConvertImageOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    const args = [
      "-i", options.input,
      ...qualityArgs(options.output, options.quality),
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  async function compositeImage(options: CompositeImageOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.overlay, "overlay");
    requireInput(options.output, "output");
    const x = options.x ?? 0;
    const y = options.y ?? 0;
    const args = [
      "-i", options.input,
      "-i", options.overlay,
      "-filter_complex", `overlay=${x}:${y}`,
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  async function compressImage(options: CompressImageOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    const args = [
      "-i", options.input,
      ...(options.width !== undefined
        ? ["-vf", `scale=${options.width}:-2`]
        : []),
      ...qualityArgs(options.output, options.quality ?? 70),
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  // ---------- 标签 ----------

  async function writeTags(options: WriteTagsOptions): Promise<RunResult> {
    requireInput(options.input, "input");
    requireInput(options.output, "output");
    const metadata: string[] = [];
    if (options.title !== undefined) {
      metadata.push(`title=${options.title}`);
    }
    if (options.artist !== undefined) {
      metadata.push(`artist=${options.artist}`);
    }
    if (options.album !== undefined) {
      metadata.push(`album=${options.album}`);
    }
    const cover = options.cover;
    const args = [
      "-i", options.input,
      ...(cover !== undefined ? ["-i", cover] : []),
      ...metadata.flatMap((value) => ["-metadata", value]),
      ...(cover !== undefined
        ? [
            "-map", "0:a:0",
            "-map", "1:v:0",
            "-c:a", "copy",
            "-c:v", "mjpeg",
            "-disposition:v", "attached_pic",
          ]
        : ["-map", "0:a:0", "-c:a", "copy"]),
      ...(cover !== undefined && /\.mp3$/iu.test(options.output)
        ? ["-id3v2_version", "3"]
        : []),
      "-progress", "pipe:1",
      "-nostats",
      ...yArgs(options.overwrite),
      options.output,
    ];
    return runner.run(args, runOptions(options));
  }

  // ---------- 原生命令 ----------

  async function runCommand(
    command: string,
    opts?: Omit<import("./types.js").RunOptions, "args">,
  ): Promise<RunResult> {
    const tokens = tokenizeCommand(command);
    if (tokens.length === 0) {
      throw new FfmpegError("CONFIGURATION", "Command is empty");
    }
    const first = tokens[0] ?? "";
    if (first === "ffprobe" || first.endsWith("/ffprobe") || first.endsWith("\\ffprobe")) {
      return runner.runFfprobe(tokens.slice(1), opts);
    }
    if (first === "ffmpeg" || first.endsWith("/ffmpeg") || first.endsWith("\\ffmpeg")) {
      return runner.run(tokens.slice(1), opts);
    }
    return runner.run(tokens, opts);
  }

  return {
    ffmpegPath: runner.ffmpegPath,
    ffprobePath: runner.ffprobePath,
    run: runner.run,
    runFfprobe: runner.runFfprobe,
    runCommand,
    probe,
    transcode,
    extractAudio,
    extractFrame,
    thumbnail,

    cut,
    concat,
    watermark,
    loopVideo,
    toGif,

    convertAudio,
    toMp3,
    toFlac,
    toWav,
    toOgg,
    toM4a,
    setVolume,
    normalizeAudio,
    joinAudio,

    resizeImage,
    cropImage,
    convertImage,
    compositeImage,
    compressImage,
    writeTags,
  };
}
