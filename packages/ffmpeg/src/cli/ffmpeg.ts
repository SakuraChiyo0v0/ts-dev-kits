#!/usr/bin/env node
import {
  CliError,
  getBool,
  getNumber,
  getString,
  handleCliError,
  outputJson,
  outputText,
  parseArgs,
  printHelp,
  requireString,
} from "@sakurachiyo0v0/cli-utils";
import { createFfmpegClient } from "../index.js";

const ffmpeg = createFfmpegClient();

/** 从 CLI 参数构造 scale,只填有值的字段。 */
function scaleFromArgs(args: ReturnType<typeof parseArgs>): { width?: number; height?: number } | undefined {
  const width = getNumber(args, "width");
  const height = getNumber(args, "height");
  if (width === undefined && height === undefined) {
    return undefined;
  }
  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

const USAGE = "Usage: amechan-ffmpeg <command> [options]";

const COMMANDS = [
  { name: "probe", desc: "Read media metadata" },
  { name: "transcode", desc: "Transcode / convert format" },
  { name: "cut", desc: "Cut a clip" },
  { name: "concat", desc: "Concatenate videos" },
  { name: "watermark", desc: "Add image watermark" },
  { name: "to-gif", desc: "Convert to animated GIF" },
  { name: "extract-frame", desc: "Extract a single frame" },
  { name: "thumbnail", desc: "Generate thumbnail" },
  { name: "extract-audio", desc: "Extract audio track" },
  { name: "convert-audio", desc: "Convert audio format" },
  { name: "set-volume", desc: "Adjust volume" },
  { name: "normalize-audio", desc: "Normalize loudness" },
  { name: "join-audio", desc: "Join audio files" },
  { name: "resize-image", desc: "Resize image" },
  { name: "crop-image", desc: "Crop image" },
  { name: "convert-image", desc: "Convert image format" },
  { name: "compress-image", desc: "Compress image" },
  { name: "composite-image", desc: "Overlay two images" },
  { name: "help", desc: "Show this help" },
];

const OPTIONS = [
  { flag: "--input, -i <path>", desc: "Input file" },
  { flag: "--output, -o <path>", desc: "Output file" },
  { flag: "--video-codec <codec>", desc: "Video codec (libx264/libvpx/...)" },
  { flag: "--audio-codec <codec>", desc: "Audio codec (aac/libmp3lame/...)" },
  { flag: "--video-bitrate <rate>", desc: "Video bitrate (e.g. 1M)" },
  { flag: "--audio-bitrate <rate>", desc: "Audio bitrate (e.g. 192k)" },
  { flag: "--width <px>", desc: "Output width (scale)" },
  { flag: "--height <px>", desc: "Output height (scale)" },
  { flag: "--start <time>", desc: "Start time (00:00:10 or 10)" },
  { flag: "--duration <time>", desc: "Duration (00:00:05 or 5)" },
  { flag: "--quality <n>", desc: "Quality (image 1-100)" },
  { flag: "--overwrite, -y", desc: "Overwrite existing output" },
];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp(USAGE, COMMANDS, OPTIONS);
    return;
  }
  const command = argv[0] ?? "";
  const args = parseArgs(argv.slice(1));

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      printHelp(USAGE, COMMANDS, OPTIONS);
      return;

    case "probe": {
      const input = requireString(args, "input", "input file");
      const info = await ffmpeg.probe(input);
      outputJson(info);
      return;
    }

    case "transcode": {
      const input = requireString(args, "input", "input file");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.transcode({
        input,
        output,
        ...(getString(args, "video-codec") !== undefined ? { videoCodec: getString(args, "video-codec")! } : {}),
        ...(getString(args, "audio-codec") !== undefined ? { audioCodec: getString(args, "audio-codec")! } : {}),
        ...(getString(args, "video-bitrate") !== undefined ? { videoBitrate: getString(args, "video-bitrate")! } : {}),
        ...(getString(args, "audio-bitrate") !== undefined ? { audioBitrate: getString(args, "audio-bitrate")! } : {}),
        ...(scaleFromArgs(args) !== undefined ? { scale: scaleFromArgs(args)! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "cut": {
      const input = requireString(args, "input", "input file");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.cut({
        input,
        output,
        ...(getString(args, "start") !== undefined ? { start: getString(args, "start")! } : {}),
        ...(getString(args, "duration") !== undefined ? { duration: getString(args, "duration")! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "concat": {
      const inputs = args.positionals.filter((p) => !p.startsWith("-"));
      if (inputs.length < 2) {
        throw new CliError("concat requires at least 2 input files as positional args");
      }
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.concat({
        inputs,
        output,
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "watermark": {
      const input = requireString(args, "input", "input file");
      const watermark = requireString(args, "watermark", "watermark image");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.watermark({
        input,
        watermark,
        output,
        ...(getString(args, "position") !== undefined
          ? { position: getString(args, "position") as "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" }
          : {}),
        ...(getNumber(args, "opacity") !== undefined ? { opacity: getNumber(args, "opacity")! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "to-gif": {
      const input = requireString(args, "input", "input file");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.toGif({
        input,
        output,
        ...(getNumber(args, "fps") !== undefined ? { fps: getNumber(args, "fps")! } : {}),
        ...(getNumber(args, "width") !== undefined ? { width: getNumber(args, "width")! } : {}),
        ...(getString(args, "start") !== undefined ? { start: getString(args, "start")! } : {}),
        ...(getString(args, "duration") !== undefined ? { duration: getString(args, "duration")! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "extract-frame": {
      const input = requireString(args, "input", "input file");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.extractFrame({
        input,
        output,
        ...(getString(args, "time") !== undefined ? { time: getString(args, "time")! } : {}),
        ...(scaleFromArgs(args) !== undefined ? { scale: scaleFromArgs(args)! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "thumbnail": {
      const input = requireString(args, "input", "input file");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.thumbnail({
        input,
        output,
        ...(getNumber(args, "width") !== undefined ? { width: getNumber(args, "width")! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "extract-audio": {
      const input = requireString(args, "input", "input file");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.extractAudio({
        input,
        output,
        ...(getString(args, "audio-codec") !== undefined ? { audioCodec: getString(args, "audio-codec")! } : {}),
        ...(getString(args, "audio-bitrate") !== undefined ? { audioBitrate: getString(args, "audio-bitrate")! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "convert-audio": {
      const input = requireString(args, "input", "input file");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.convertAudio({
        input,
        output,
        ...(getString(args, "audio-codec") !== undefined ? { audioCodec: getString(args, "audio-codec")! } : {}),
        ...(getString(args, "audio-bitrate") !== undefined ? { audioBitrate: getString(args, "audio-bitrate")! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "set-volume": {
      const input = requireString(args, "input", "input file");
      const output = requireString(args, "output", "output file");
      const volume = requireString(args, "volume", "volume (e.g. 1.5 or 3dB)");
      const result = await ffmpeg.setVolume({
        input,
        output,
        volume: /^-?\d+(\.\d+)?$/u.test(volume) ? Number(volume) : volume,
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "normalize-audio": {
      const input = requireString(args, "input", "input file");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.normalizeAudio({
        input,
        output,
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "join-audio": {
      const inputs = args.positionals.filter((p) => !p.startsWith("-"));
      if (inputs.length < 2) {
        throw new CliError("join-audio requires at least 2 input files as positional args");
      }
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.joinAudio({
        inputs,
        output,
        ...(getString(args, "audio-codec") !== undefined ? { audioCodec: getString(args, "audio-codec")! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "resize-image": {
      const input = requireString(args, "input", "input file");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.resizeImage({
        input,
        output,
        ...(getNumber(args, "width") !== undefined ? { width: getNumber(args, "width")! } : {}),
        ...(getNumber(args, "height") !== undefined ? { height: getNumber(args, "height")! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "crop-image": {
      const input = requireString(args, "input", "input file");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.cropImage({
        input,
        output,
        width: getNumber(args, "width") ?? 0,
        height: getNumber(args, "height") ?? 0,
        ...(getNumber(args, "x") !== undefined ? { x: getNumber(args, "x")! } : {}),
        ...(getNumber(args, "y") !== undefined ? { y: getNumber(args, "y")! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "convert-image": {
      const input = requireString(args, "input", "input file");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.convertImage({
        input,
        output,
        ...(getNumber(args, "quality") !== undefined ? { quality: getNumber(args, "quality")! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "compress-image": {
      const input = requireString(args, "input", "input file");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.compressImage({
        input,
        output,
        ...(getNumber(args, "width") !== undefined ? { width: getNumber(args, "width")! } : {}),
        ...(getNumber(args, "quality") !== undefined ? { quality: getNumber(args, "quality")! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    case "composite-image": {
      const input = requireString(args, "input", "input file");
      const overlay = requireString(args, "overlay", "overlay image");
      const output = requireString(args, "output", "output file");
      const result = await ffmpeg.compositeImage({
        input,
        overlay,
        output,
        ...(getNumber(args, "x") !== undefined ? { x: getNumber(args, "x")! } : {}),
        ...(getNumber(args, "y") !== undefined ? { y: getNumber(args, "y")! } : {}),
        overwrite: getBool(args, "overwrite") || getBool(args, "y"),
      });
      outputJson({ exitCode: result.exitCode, output });
      return;
    }

    default:
      outputText(`Unknown command: ${command}`);
      printHelp(USAGE, COMMANDS, OPTIONS);
      throw new CliError(`Unknown command: ${command}`, 2);
  }
}

main().catch(handleCliError);
