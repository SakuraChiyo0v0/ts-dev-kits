#!/usr/bin/env node
/**
 * amechan-netease CLI:login / status / logout / parse / download。
 * 测试/自定义网关支持环境变量注入:
 *   AMECHAN_NETEASE_BASE_URL  — 覆盖 API baseUrl(测试用 mock 服务器)
 *   AMECHAN_NETEASE_AUTH_PATH — 覆盖登录态存储路径
 */
import { pathToFileURL } from "node:url";
import {
  qrcodeLogin,
  AuthStore,
  AccountError,
} from "@sakurachiyo0v0/account";
import {
  getBool,
  getString,
  handleCliError,
  outputError,
  outputJson,
  outputText,
  printHelp,
  ProgressBar,
  parseArgs,
} from "@sakurachiyo0v0/cli-utils";
import { createNeteaseClient, NeteaseMusicClient } from "../client.js";
import { NeteaseError } from "../errors.js";

const USAGE = "amechan-netease <command> [options]";
const COMMANDS = [
  { name: "login", desc: "二维码扫码登录并持久化登录态" },
  { name: "status", desc: "显示登录状态" },
  { name: "logout", desc: "删除存储的登录态" },
  { name: "parse", desc: "解析链接,输出歌曲清单" },
  { name: "download", desc: "下载歌曲/歌单/专辑" },
];
const OPTIONS = [
  { flag: "--auth-path <path>", desc: "登录态存储路径(默认平台配置目录)" },
  { flag: "--no-browser", desc: "login 时不自动打开浏览器" },
  { flag: "--level <level>", desc: "品质 standard|higher|exhigh|lossless|hires(默认 exhigh)" },
  { flag: "--output-dir <dir>", desc: "下载输出目录(默认当前目录)" },
  { flag: "--no-lyric", desc: "不下载歌词" },
  { flag: "--no-cover", desc: "不下载封面" },
  { flag: "--lyric-mode <mode>", desc: "歌词 original|translated|both(默认 both)" },
  { flag: "--json", desc: "输出 JSON(默认)" },
];

interface CliContext {
  authPath?: string;
  baseUrl?: string;
}

/** 环境变量注入:测试/自定义网关用。 */
function envBaseUrl(): string | undefined {
  const value = process.env.AMECHAN_NETEASE_BASE_URL;
  return value !== undefined && value !== "" ? value : undefined;
}

function envAuthPath(): string | undefined {
  const value = process.env.AMECHAN_NETEASE_AUTH_PATH;
  return value !== undefined && value !== "" ? value : undefined;
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const command = args.positionals[0];
  const context: CliContext = {};
  const baseUrl = envBaseUrl();
  if (baseUrl !== undefined) {
    context.baseUrl = baseUrl;
  }
  const authPath = getString(args, "auth-path") ?? envAuthPath();
  if (authPath !== undefined) {
    context.authPath = authPath;
  }

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    printHelp(USAGE, COMMANDS, OPTIONS);
    return;
  }

  switch (command) {
    case "login":
      await runLogin(context, args);
      break;
    case "status":
      await runStatus(context);
      break;
    case "logout":
      await runLogout(context);
      break;
    case "parse":
      await runParse(context, args);
      break;
    case "download":
      await runDownload(context, args);
      break;
    default:
      outputError(`Unknown command: ${command}`);
      printHelp(USAGE, COMMANDS, OPTIONS);
      process.exitCode = 1;
  }
}

async function runLogin(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const store = new AuthStore({
    platform: "netease-music",
    ...(context.authPath !== undefined ? { path: context.authPath } : {}),
  });
  outputText(`登录态存储: ${store.path}`);
  outputText("正在生成二维码,请使用网易云音乐 App 扫码...");
  const result = await qrcodeLogin({
    adapter: NeteaseMusicClient.qrAdapter({
      ...(context.baseUrl !== undefined ? { baseUrl: context.baseUrl } : {}),
    }),
    store,
    autoOpenBrowser: getBool(args, "no-browser") ? false : true,
    onStatus: (status) => {
      if (status.state !== "waiting") {
        outputText(`[${status.state}] ${status.message}`);
      }
    },
  });
  if (result.saved) {
    outputJson({ ok: true, message: "登录成功,登录态已保存" });
  } else {
    outputJson({ ok: true, message: "登录成功", credentials: result.credentials });
  }
}

async function runStatus(context: CliContext): Promise<void> {
  const store = new AuthStore({
    platform: "netease-music",
    ...(context.authPath !== undefined ? { path: context.authPath } : {}),
  });
  const payload = await store.load();
  if (payload === null) {
    outputJson({ loggedIn: false, message: "未登录,请运行 amechan-netease login" });
    return;
  }
  const cred = payload.credentials as { cookies?: string };
  const hasMUSICU = typeof cred.cookies === "string" && cred.cookies.includes("MUSIC_U=");
  outputJson({
    loggedIn: hasMUSICU,
    path: store.path,
    savedAt: payload.savedAt,
    ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
  });
}

async function runLogout(context: CliContext): Promise<void> {
  const store = new AuthStore({
    platform: "netease-music",
    ...(context.authPath !== undefined ? { path: context.authPath } : {}),
  });
  await store.clear();
  outputJson({ ok: true, message: "已登出" });
}

async function runParse(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const url = args.positionals[1];
  if (url === undefined) {
    throw new NeteaseError("INVALID_URL", "缺少链接参数,用法: amechan-netease parse <url>");
  }
  const client = createNeteaseClient({
    ...(context.authPath !== undefined ? { authPath: context.authPath } : {}),
    ...(context.baseUrl !== undefined ? { baseUrl: context.baseUrl } : {}),
  });
  const parsed = await client.parse(url);
  outputJson({
    count: parsed.songs.length,
    songs: parsed.songs.map((song) => ({
      id: song.id,
      title: song.title,
      artists: song.artists ?? [],
    })),
  });
}

async function runDownload(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const input = args.positionals[1];
  if (input === undefined) {
    throw new NeteaseError("INVALID_URL", "缺少链接/歌曲 ID,用法: amechan-netease download <url|id>");
  }
  const client = createNeteaseClient({
    ...(context.authPath !== undefined ? { authPath: context.authPath } : {}),
    ...(context.baseUrl !== undefined ? { baseUrl: context.baseUrl } : {}),
  });
  const levelInput = getString(args, "level") ?? "exhigh";
  const VALID_LEVELS = ["standard", "higher", "exhigh", "lossless", "hires"] as const;
  if (!VALID_LEVELS.includes(levelInput as (typeof VALID_LEVELS)[number])) {
    throw new NeteaseError(
      "INVALID_URL",
      `无效品质: ${levelInput}(可选 ${VALID_LEVELS.join("|")})`,
    );
  }
  const level = levelInput as (typeof VALID_LEVELS)[number];
  const outputDir = getString(args, "output-dir") ?? ".";
  const lyricMode = (getString(args, "lyric-mode") ?? "both") as "original" | "translated" | "both";

  const parsed = await client.parse(input);
  const songs = parsed.songs;
  if (songs.length === 0) {
    throw new NeteaseError("NOT_FOUND", "未找到可下载歌曲");
  }
  outputText(`共 ${songs.length} 首,开始下载(品质 ${level})...`);

  let index = 0;
  for (const song of songs) {
    index += 1;
    const bar = new ProgressBar(`[${index}/${songs.length}] ${song.title}`, 100);
    try {
      const result = await client.download(song, {
        outputDir,
        level,
        lyric: !getBool(args, "no-lyric"),
        lyricMode,
        cover: !getBool(args, "no-cover"),
        onProgress: (progress) => {
          if (progress.total > 0) {
            bar.update(Math.round(progress.percent));
          }
        },
      });
      bar.finish();
      outputJson({
        ok: true,
        file: result.filePath,
        level: result.level,
        ...(result.lyricPath !== undefined ? { lyric: result.lyricPath } : {}),
        ...(result.coverPath !== undefined ? { cover: result.coverPath } : {}),
      });
    } catch (error) {
      bar.finish();
      throw error;
    }
  }
}

// 直接作为可执行文件运行时才执行(被测试 import 时不触发)。
const isDirectRun =
  process.argv[1] !== undefined &&
  (() => {
    try {
      return import.meta.url === pathToFileURL(process.argv[1]).href;
    } catch {
      return false;
    }
  })();

if (isDirectRun) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    if (error instanceof AccountError || error instanceof NeteaseError) {
      outputError(`${error.code}: ${error.message}`);
      process.exit(1);
    }
    handleCliError(error);
  });
}

export { main };
export type { CliContext };
