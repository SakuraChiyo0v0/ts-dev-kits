#!/usr/bin/env node
/**
 * sc-booth CLI:login / status / logout / parse / claim / download。
 * 测试/自定义网关支持环境变量注入:
 *   AMECHAN_BOOTH_BASE_URL  — 覆盖 API baseUrl(测试用 mock 服务器)
 *   AMECHAN_BOOTH_AUTH_PATH — 覆盖登录态存储路径
 */
import { AuthStore } from "@sakurachiyo0v0/account";
import {
  getBool,
  getNumber,
  getString,
  handleCliError,
  outputError,
  outputJson,
  outputText,
  printHelp,
  parseArgs,
} from "@sakurachiyo0v0/cli-utils";
import { createBoothClient, loginBooth } from "../client.js";
import { BoothError } from "../errors.js";

const USAGE = "sc-booth <command> [options]";
const COMMANDS = [
  { name: "help", desc: "显示帮助" },
  { name: "login", desc: "浏览器登录捕获会话并持久化" },
  { name: "status", desc: "显示登录状态" },
  { name: "logout", desc: "删除存储的登录态" },
  { name: "parse", desc: "解析商品链接/ID,输出商品信息" },
  { name: "claim", desc: "领取商品(免费直接下载;付费加入购物车)" },
  { name: "download", desc: "按下载直链下载文件" },
];
const OPTIONS = [
  { flag: "--auth-path <path>", desc: "登录态存储路径(默认平台配置目录)" },
  { flag: "--manual", desc: "login 时手动粘贴 cookie(替代浏览器捕获)" },
  { flag: "--reuse", desc: "login 复用日常浏览器登录态(免重新输账号;需先关闭该浏览器)" },
  { flag: "--output-dir <dir>", desc: "下载输出目录(默认当前目录)" },
  { flag: "--concurrency <n>", desc: "批量领取并发(默认 1)" },
  { flag: "--no-download", desc: "claim 后不自动下载(默认免费商品领取后下载)" },
  { flag: "--detail", desc: "parse 输出简介/正文 + 全部购买项(默认仅基础信息)" },
  { flag: "--no-description", desc: "--detail 时不含简介/正文" },
  { flag: "--no-variations", desc: "--detail 时不含购买项列表" },
  { flag: "--json", desc: "输出 JSON(默认)" },
];

interface CliContext {
  authPath?: string;
  baseUrl?: string;
}

function envBaseUrl(): string | undefined {
  const value = process.env.AMECHAN_BOOTH_BASE_URL;
  return value !== undefined && value !== "" ? value : undefined;
}

function envAuthPath(): string | undefined {
  const value = process.env.AMECHAN_BOOTH_AUTH_PATH;
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
    case "help":
      printHelp(USAGE, COMMANDS, OPTIONS);
      break;
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
    case "claim":
      await runClaim(context, args);
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
  if (getBool(args, "manual")) {
    await runLoginManual(context);
    return;
  }
  if (getBool(args, "reuse")) {
    outputText("复用日常浏览器登录态:");
    outputText("1. 请先完全关闭 Chrome/Edge(正在运行会报错)。");
    outputText("2. SDK 将用你的日常浏览器 profile 启动,直接读取已登录的 Pixiv 会话,无需重新输入账号密码。");
    const result = await loginBooth({
      ...(context.authPath !== undefined ? { authPath: context.authPath } : {}),
      reuseBrowserProfile: true,
    });
    outputJson({ ok: true, message: "已复用日常浏览器登录态并保存", account: result.account });
    return;
  }
  outputText("自动浏览器登录:");
  outputText("1. 将打开一个独立 Chrome 窗口,显示 BOOTH 登录页。");
  outputText("2. 用 Pixiv 账号登录;登录成功后 SDK 自动捕获会话,无需复制粘贴。");
  const result = await loginBooth({
    ...(context.authPath !== undefined ? { authPath: context.authPath } : {}),
  });
  outputJson({ ok: true, message: "登录成功,登录态已保存", account: result.account });
}

async function runLoginManual(context: CliContext): Promise<void> {
  outputText("手动登录模式:请在浏览器登录 BOOTH 后,复制 Cookie 头内容粘贴到下面:");
  outputText("(浏览器 F12 → Network → 任意 booth.pm 请求 → Request Headers → Cookie 的值)");
  const cookie = await readStdin();
  const trimmed = cookie.trim();
  if (trimmed === "") {
    throw new BoothError("LOGIN_REQUIRED", "未输入 cookie");
  }
  const client = createBoothClient({
    ...(context.authPath !== undefined ? { authPath: context.authPath } : {}),
    ...(context.baseUrl !== undefined ? { baseUrl: context.baseUrl } : {}),
    cookie: trimmed,
  });
  await client.persistLogin(context.authPath);
  outputJson({ ok: true, message: "登录态已保存" });
}

async function runStatus(context: CliContext): Promise<void> {
  const store = new AuthStore({
    platform: "booth",
    ...(context.authPath !== undefined ? { path: context.authPath } : {}),
  });
  const payload = await store.load();
  if (payload === null) {
    outputJson({ loggedIn: false, message: "未登录,请运行 sc-booth login" });
    return;
  }
  const cred = payload.credentials as { cookies?: string };
  outputJson({
    loggedIn: typeof cred.cookies === "string" && cred.cookies !== "",
    path: store.path,
    savedAt: payload.savedAt,
    ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
  });
}

async function runLogout(context: CliContext): Promise<void> {
  const store = new AuthStore({
    platform: "booth",
    ...(context.authPath !== undefined ? { path: context.authPath } : {}),
  });
  await store.clear();
  outputJson({ ok: true, message: "已登出" });
}

async function runParse(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const input = args.positionals[1];
  if (input === undefined) {
    throw new BoothError("INVALID_URL", "缺少参数,用法: sc-booth parse <链接|ID>");
  }
  const client = createBoothClient({
    ...(context.authPath !== undefined ? { authPath: context.authPath } : {}),
    ...(context.baseUrl !== undefined ? { baseUrl: context.baseUrl } : {}),
  });
  // --detail:输出简介/正文 + 全部购买项(默认只输出基础信息,省 token)。
  if (getBool(args, "detail")) {
    const detail = await client.getItemDetail(input, {
      // --no-description / --no-variations 可进一步裁剪。
      ...(getBool(args, "no-description") ? { description: false } : {}),
      ...(getBool(args, "no-variations") ? { variations: false } : {}),
    });
    outputJson({
      id: detail.id,
      title: detail.title,
      priceYen: detail.priceYen,
      shopId: detail.shopId,
      ...(detail.shopName !== undefined ? { shopName: detail.shopName } : {}),
      alreadyOwned: detail.alreadyOwned,
      description: detail.description,
      variations: detail.variations.map((v) => ({
        id: v.id,
        name: v.name,
        priceYen: v.priceYen,
        free: v.free,
        ...(v.downloadUrl !== undefined ? { downloadUrl: v.downloadUrl } : {}),
        ...(v.variationId !== undefined ? { variationId: v.variationId } : {}),
      })),
    });
    return;
  }
  const item = await client.getItem(input);
  outputJson({
    id: item.id,
    title: item.title,
    priceYen: item.priceYen,
    shopId: item.shopId,
    ...(item.shopName !== undefined ? { shopName: item.shopName } : {}),
    alreadyOwned: item.alreadyOwned,
  });
}

async function runClaim(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const inputs = args.positionals.slice(1);
  if (inputs.length === 0) {
    throw new BoothError("INVALID_URL", "缺少商品参数,用法: sc-booth claim <链接|ID>...");
  }
  const client = createBoothClient({
    ...(context.authPath !== undefined ? { authPath: context.authPath } : {}),
    ...(context.baseUrl !== undefined ? { baseUrl: context.baseUrl } : {}),
  });
  const concurrency = getNumber(args, "concurrency", 1) ?? 1;
  const results = await client.claim(inputs, { concurrency });

  // 免费领取默认自动下载,输出里附带文件路径。
  const output: Array<Record<string, unknown>> = [];
  const outputDir = getString(args, "output-dir") ?? ".";
  for (const result of results) {
    const entry: Record<string, unknown> = { ...result };
    if (!getBool(args, "no-download") && result.status === "claimed" && result.downloadUrl !== undefined) {
      outputText(`下载 ${result.itemId}...`);
      try {
        const files = await client.downloadUrl(result.downloadUrl, { outputDir });
        entry.files = files;
      } catch (error) {
        entry.downloadError = error instanceof Error ? error.message : String(error);
      }
    }
    output.push(entry);
  }
  outputJson({ results: output });
}

async function runDownload(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const url = args.positionals[1];
  if (url === undefined) {
    throw new BoothError("INVALID_URL", "缺少下载链接,用法: sc-booth download <download-url>");
  }
  const client = createBoothClient({
    ...(context.authPath !== undefined ? { authPath: context.authPath } : {}),
    ...(context.baseUrl !== undefined ? { baseUrl: context.baseUrl } : {}),
  });
  const outputDir = getString(args, "output-dir") ?? ".";
  const files = [await client.downloadUrl(url, { outputDir })];
  outputJson({ ok: true, files });
}

function readStdin(): Promise<string> {
  return new Promise((resolvePromise) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolvePromise(data));
    process.stdin.on("error", () => resolvePromise(data));
  });
}

main(process.argv.slice(2)).catch(handleCliError);
