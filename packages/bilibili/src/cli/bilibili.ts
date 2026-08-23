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
import { AuthStore, qrcodeLogin } from "@sakurachiyo0v0/account";
import { bilibiliQrAdapter } from "../auth/index.js";
import { createBilibiliClient } from "../index.js";

const USAGE = "Usage: amechan-bilibili <command> [options]";

const COMMANDS = [
  { name: "login", desc: "Scan QR code to log in (opens browser window)" },
  { name: "logout", desc: "Clear stored login" },
  { name: "status", desc: "Show login status" },
  { name: "parse", desc: "Parse a bilibili URL into media items" },
  { name: "streams", desc: "Get play streams for a media item" },
  { name: "download", desc: "Download a media item (with merge)" },
  { name: "help", desc: "Show this help" },
];

const OPTIONS = [
  { flag: "--url <url>", desc: "Bilibili URL to parse" },
  { flag: "--cookie <cookie>", desc: "Login cookie (SESSDATA=...; bili_jct=...)" },
  { flag: "--auth-path <path>", desc: "Auth store file path (default: platform user config dir)" },
  { flag: "--no-browser", desc: "Do not open browser window (print QR url only)" },
  { flag: "--timeout <sec>", desc: "Login timeout in seconds (default 180)" },
  { flag: "--output-dir <dir>", desc: "Output directory" },
  { flag: "--quality <n>", desc: "Target quality (80=1080P, 64=720P)" },
  { flag: "--codec <n>", desc: "Video codec (7=AVC, 12=HEVC, 13=AV1)" },
  { flag: "--no-merge", desc: "Skip ffmpeg merge" },
  { flag: "--concurrency <n>", desc: "Download concurrency (default 4)" },
  { flag: "--index <n>", desc: "Media item index (default 0)" },
];

function makeClient(args: ReturnType<typeof parseArgs>) {
  const cookie = getString(args, "cookie") ?? process.env.BILI_COOKIE;
  const authPath = getString(args, "auth-path") ?? process.env.BILI_AUTH_PATH;
  return createBilibiliClient({
    ...(cookie !== undefined ? { cookie } : {}),
    ...(authPath !== undefined ? { authPath } : {}),
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

    case "login": {
      const authPath = getString(args, "auth-path") ?? process.env.BILI_AUTH_PATH;
      const store = new AuthStore({
        platform: "bilibili",
        ...(authPath !== undefined ? { path: authPath } : {}),
      });
      const noBrowser = getBool(args, "no-browser");
      const timeoutSec = getNumber(args, "timeout");
      outputText(noBrowser ? "登录:打印二维码地址,请手动打开扫码" : "登录:正在打开浏览器窗口,请用哔哩哔哩 App 扫码...");
      const result = await qrcodeLogin({
        adapter: bilibiliQrAdapter(),
        store,
        autoOpenBrowser: !noBrowser,
        ...(timeoutSec !== undefined ? { timeoutMs: timeoutSec * 1000 } : {}),
      });
      if (result.saved) {
        outputJson({ ok: true, authPath: store.path, savedAt: new Date().toISOString() });
      } else {
        outputJson({ ok: true, credentials: result.credentials });
      }
      return;
    }

    case "logout": {
      const authPath = getString(args, "auth-path") ?? process.env.BILI_AUTH_PATH;
      const store = new AuthStore({
        platform: "bilibili",
        ...(authPath !== undefined ? { path: authPath } : {}),
      });
      await store.clear();
      outputJson({ ok: true, authPath: store.path });
      return;
    }

    case "status": {
      const authPath = getString(args, "auth-path") ?? process.env.BILI_AUTH_PATH;
      const store = new AuthStore({
        platform: "bilibili",
        ...(authPath !== undefined ? { path: authPath } : {}),
      });
      const payload = await store.load();
      if (payload === null) {
        outputJson({ ok: true, loggedIn: false, authPath: store.path });
        return;
      }
      outputJson({
        ok: true,
        loggedIn: true,
        authPath: store.path,
        savedAt: payload.savedAt,
        ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
      });
      return;
    }

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
