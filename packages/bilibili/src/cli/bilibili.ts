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
} from "@amechan/cli-utils";
import { createBilibiliClient } from "../index.js";

const USAGE = "Usage: amechan-bilibili <command> [options]";

const COMMANDS = [
  { name: "parse", desc: "Parse a bilibili URL into media items" },
  { name: "streams", desc: "Get play streams for a media item" },
  { name: "download", desc: "Download a media item (with merge)" },
  { name: "help", desc: "Show this help" },
];

const OPTIONS = [
  { flag: "--url <url>", desc: "Bilibili URL to parse" },
  { flag: "--cookie <cookie>", desc: "Login cookie (SESSDATA=...; bili_jct=...)" },
  { flag: "--output-dir <dir>", desc: "Output directory" },
  { flag: "--quality <n>", desc: "Target quality (80=1080P, 64=720P)" },
  { flag: "--codec <n>", desc: "Video codec (7=AVC, 12=HEVC, 13=AV1)" },
  { flag: "--no-merge", desc: "Skip ffmpeg merge" },
  { flag: "--concurrency <n>", desc: "Download concurrency (default 4)" },
  { flag: "--index <n>", desc: "Media item index (default 0)" },
];

function makeClient(args: ReturnType<typeof parseArgs>) {
  const cookie = getString(args, "cookie") ?? process.env.BILI_COOKIE;
  return createBilibiliClient({
    ...(cookie !== undefined ? { cookie } : {}),
    download: {
      ...(getNumber(args, "concurrency") !== undefined ? { concurrency: getNumber(args, "concurrency")! } : {}),
    },
  });
}

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

    case "parse": {
      const url = requireString(args, "url", "bilibili URL");
      const client = makeClient(args);
      const items = await client.parse(url);
      outputJson(items);
      return;
    }

    case "streams": {
      const url = requireString(args, "url", "bilibili URL");
      const client = makeClient(args);
      const items = await client.parse(url);
      const index = getNumber(args, "index") ?? 0;
      const item = items[index];
      if (item === undefined) {
        throw new CliError(`No media item at index ${index}`);
      }
      const streams = await client.getStreams(item, {
        ...(getNumber(args, "quality") !== undefined ? { quality: getNumber(args, "quality")! } : {}),
        ...(getNumber(args, "codec") !== undefined ? { codec: getNumber(args, "codec")! as 7 | 12 | 13 } : {}),
      });
      outputJson(streams);
      return;
    }

    case "download": {
      const url = requireString(args, "url", "bilibili URL");
      const outputDir = requireString(args, "output-dir", "output directory");
      const client = makeClient(args);
      const items = await client.parse(url);
      const index = getNumber(args, "index") ?? 0;
      const item = items[index];
      if (item === undefined) {
        throw new CliError(`No media item at index ${index}`);
      }
      const merge = getBool(args, "no-merge") ? false : true;
      const output = await client.download(item, {
        outputDir,
        merge,
        ...(getNumber(args, "quality") !== undefined ? { quality: getNumber(args, "quality")! } : {}),
      });
      outputJson({ ok: true, output });
      return;
    }

    default:
      outputText(`Unknown command: ${command}`);
      printHelp(USAGE, COMMANDS, OPTIONS);
      throw new CliError(`Unknown command: ${command}`, 2);
  }
}

main().catch(handleCliError);
