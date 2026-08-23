#!/usr/bin/env node
/**
 * amechan-steam CLI:login / status / logout / user / owned-games / achievements /
 * price / search / inventory / my-listings。
 * 环境变量注入(测试/自定义网关):
 *   AMECHAN_STEAM_AUTH_PATH      — 覆盖登录态存储路径
 *   AMECHAN_STEAM_API_KEY        — Web API user key
 *   AMECHAN_STEAM_PUBLISHER_KEY  — publisher key
 *   AMECHAN_STEAM_PROXY          — 代理(community 国内不可达时配置)
 *   AMECHAN_STEAM_BASE_URLS      — JSON 覆盖四台主机({api,store,community,login})
 */
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
import { createSteamClient, type SteamClient } from "../client.js";

const USAGE = "amechan-steam <command> [options]";
const COMMANDS = [
  { name: "help", desc: "显示帮助" },
  { name: "login", desc: "密码/二维码/cookie 登录并持久化(--account/--qr/--cookie)" },
  { name: "status", desc: "显示登录状态" },
  { name: "logout", desc: "清除存储的登录态" },
  { name: "user", desc: "玩家资料摘要(<steamid|vanity|URL>)" },
  { name: "owned-games", desc: "游戏库(<steamid|vanity|URL>)" },
  { name: "achievements", desc: "成就(<steamid|vanity|URL> <appid>)" },
  { name: "price", desc: "单件即时价(<appid> <market_hash_name>)" },
  { name: "search", desc: "市场搜索(<query>)" },
  { name: "inventory", desc: "玩家库存(<steamid|vanity|URL> <appid> [contextid])" },
  { name: "my-listings", desc: "我的市场挂单(需登录态)" },
  { name: "reviews", desc: "商店评测(<appid>)" },
  { name: "redeem", desc: "兑换激活码(<key>,写操作,需登录态)" },
  { name: "watch", desc: "价格监控:即时价+订单簿+价格历史(<appid> <market_hash_name>)" },
];
const OPTIONS = [
  { flag: "--account <name>", desc: "login 账号名" },
  { flag: "--qr", desc: "login 使用二维码登录" },
  { flag: "--cookie <cookies>", desc: "login 直接导入 Cookie 头字符串" },
  { flag: "--auth-path <path>", desc: "登录态存储路径(默认平台配置目录)" },
  { flag: "--api-key <key>", desc: "Steam Web API user key" },
  { flag: "--publisher-key <key>", desc: "publisher key(GetItemDefs 等)" },
  { flag: "--proxy <url>", desc: "代理 http(s):// 或 socks5://" },
  { flag: "--currency <n>", desc: "货币代码(price,默认 1=USD)" },
  { flag: "--appid <n>", desc: "appid(search 过滤)" },
  { flag: "--count <n>", desc: "条数上限" },
  { flag: "--contextid <id>", desc: "库存 contextid(默认 2)" },
  { flag: "--language <lang>", desc: "本地化语言(如 schinese)" },
  { flag: "--filter <recent|updated|all>", desc: "评测过滤(reviews,默认 recent)" },
  { flag: "--interval <s>", desc: "watch 轮询间隔秒数(默认 30)" },
  { flag: "--json", desc: "输出 JSON(默认)" },
];

interface CliContext {
  authPath?: string;
  apiKey?: string;
  publisherKey?: string;
  proxy?: string;
  baseUrls?: Record<string, string>;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value !== "" ? value : undefined;
}

function envBaseUrls(): Record<string, string> | undefined {
  const raw = env("AMECHAN_STEAM_BASE_URLS");
  if (raw === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    outputError("AMECHAN_STEAM_BASE_URLS 不是合法 JSON,忽略");
    return undefined;
  }
}

function buildClient(context: CliContext): SteamClient {
  return createSteamClient({
    ...(context.apiKey !== undefined ? { apiKey: context.apiKey } : {}),
    ...(context.publisherKey !== undefined ? { publisherKey: context.publisherKey } : {}),
    ...(context.proxy !== undefined ? { proxy: context.proxy } : {}),
    ...(context.baseUrls !== undefined ? { baseUrls: context.baseUrls } : {}),
    ...(context.authPath !== undefined ? { sessionPath: context.authPath } : {}),
  });
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const command = args.positionals[0];
  const context: CliContext = {};
  const authPath = getString(args, "auth-path") ?? env("AMECHAN_STEAM_AUTH_PATH");
  if (authPath !== undefined) context.authPath = authPath;
  const apiKey = getString(args, "api-key") ?? env("AMECHAN_STEAM_API_KEY");
  if (apiKey !== undefined) context.apiKey = apiKey;
  const publisherKey = getString(args, "publisher-key") ?? env("AMECHAN_STEAM_PUBLISHER_KEY");
  if (publisherKey !== undefined) context.publisherKey = publisherKey;
  const proxy = getString(args, "proxy") ?? env("AMECHAN_STEAM_PROXY");
  if (proxy !== undefined) context.proxy = proxy;
  const baseUrls = envBaseUrls();
  if (baseUrls !== undefined) context.baseUrls = baseUrls;

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
    case "user":
      await runUser(context, args);
      break;
    case "owned-games":
      await runOwnedGames(context, args);
      break;
    case "achievements":
      await runAchievements(context, args);
      break;
    case "price":
      await runPrice(context, args);
      break;
    case "search":
      await runSearch(context, args);
      break;
    case "inventory":
      await runInventory(context, args);
      break;
    case "my-listings":
      await runMyListings(context);
      break;
    case "reviews":
      await runReviews(context, args);
      break;
    case "redeem":
      await runRedeem(context, args);
      break;
    case "watch":
      await runWatch(context, args);
      break;
    default:
      outputError(`Unknown command: ${command}`);
      printHelp(USAGE, COMMANDS, OPTIONS);
      process.exitCode = 1;
  }
}

async function runLogin(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const client = buildClient(context);

  const cookie = getString(args, "cookie");
  if (cookie !== undefined) {
    await client.auth.importCookies(cookie, { save: true });
    outputJson({ ok: true, message: "cookie 已导入并保存", loggedIn: true });
    await client.close();
    return;
  }

  if (getBool(args, "qr")) {
    outputText("二维码登录:即将弹出二维码页面,请用 Steam 手机 App 扫码确认…");
    const result = await client.auth.loginWithQr({
      autoOpenBrowser: true,
      pollIntervalMs: 1500,
      timeoutMs: 180_000,
      onStatus: (status) => {
        if (status.state === "waiting") outputText("请用 Steam App 扫描弹出的二维码");
        if (status.state === "scanned") outputText("已扫码,请在手机上确认…");
        if (status.state === "expired") outputText("二维码已过期,重新生成…");
      },
    });
    outputJson({ ok: true, message: "登录成功,登录态已保存", saved: result.saved });
    await client.close();
    return;
  }

  const accountName = getString(args, "account") ?? (await promptText("账号: "));
  const password = await promptText("密码: ");
  outputText("登录中…(如开启邮箱/令牌验证,将提示输入验证码)");
  const result = await client.auth.loginWithPassword({
    accountName,
    password,
    onNeedCode: async ({ method, message, attempt }) => {
      const hint = method === "totp" ? "手机令牌验证码" : "邮箱验证码";
      const answer = await promptText(`[${attempt}] ${hint}: ${message ?? ""}`);
      return answer.trim();
    },
  });
  outputJson({
    ok: true,
    message: "登录成功,登录态已保存",
    saved: result.saved,
    ...(result.credentials !== undefined
      ? {
          accountName: (result.credentials as { accountName?: string }).accountName,
          steamid: (result.credentials as { steamid?: string }).steamid,
        }
      : {}),
  });
  await client.close();
}

async function runStatus(context: CliContext): Promise<void> {
  const client = buildClient(context);
  const status = client.auth.status();
  outputJson({
    loggedIn: status.loggedIn,
    path: context.authPath ?? "(默认)",
    ...(status.accountName !== undefined ? { accountName: status.accountName } : {}),
    ...(status.steamid !== undefined ? { steamid: status.steamid } : {}),
    ...(status.loggedIn ? {} : { message: "未登录,请运行 amechan-steam login" }),
  });
  await client.close();
}

async function runLogout(context: CliContext): Promise<void> {
  const client = buildClient(context);
  await client.auth.logout();
  outputJson({ ok: true, message: "已登出" });
  await client.close();
}

async function runUser(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const input = args.positionals[1];
  if (input === undefined) {
    throw new Error("缺少参数,用法: amechan-steam user <steamid|vanity|URL>");
  }
  const client = buildClient(context);
  const players = await client.user.getSummaries([input]);
  const p = players[0];
  outputJson(
    p === undefined
      ? { ok: false, message: "未找到玩家" }
      : {
          steamid: p.steamid,
          name: p.personaname,
          profileurl: p.profileurl,
          personastate: p.personastate,
          ...(p.gameextrainfo !== undefined ? { playing: p.gameextrainfo } : {}),
          ...(p.lastlogoff !== undefined ? { lastlogoff: p.lastlogoff } : {}),
        },
  );
  await client.close();
}

async function runOwnedGames(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const input = args.positionals[1];
  if (input === undefined) {
    throw new Error("缺少参数,用法: amechan-steam owned-games <steamid|vanity|URL>");
  }
  const client = buildClient(context);
  const result = await client.library.getOwnedGames(input, { includeAppInfo: true });
  outputJson({
    gameCount: result.gameCount,
    privacyRestricted: result.privacyRestricted,
    games: result.games.slice(0, getNumber(args, "count", 50) ?? 50).map((g) => ({
      appid: g.appid,
      ...(g.name !== undefined ? { name: g.name } : {}),
      playtime_forever: g.playtime_forever,
      ...(g.playtime_2weeks !== undefined ? { playtime_2weeks: g.playtime_2weeks } : {}),
    })),
  });
  await client.close();
}

async function runAchievements(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const input = args.positionals[1];
  const appid = Number(args.positionals[2]);
  if (input === undefined || Number.isNaN(appid)) {
    throw new Error("缺少参数,用法: amechan-steam achievements <steamid|vanity|URL> <appid>");
  }
  const client = buildClient(context);
  const result = await client.stats.getPlayerAchievements(input, appid);
  outputJson({
    ...(result.steamId !== undefined ? { steamid: result.steamId } : {}),
    gameName: result.gameName,
    privacyRestricted: result.privacyRestricted,
    achievements: result.achievements.map((a) => ({
      name: a.name ?? a.apiname,
      achieved: a.achieved === 1,
      ...(a.unlocktime !== undefined ? { unlocktime: a.unlocktime } : {}),
    })),
  });
  await client.close();
}

async function runPrice(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const appid = Number(args.positionals[1]);
  const marketHashName = args.positionals[2];
  if (Number.isNaN(appid) || marketHashName === undefined) {
    throw new Error("缺少参数,用法: amechan-steam price <appid> <market_hash_name>");
  }
  const client = buildClient(context);
  const currency = getNumber(args, "currency", 1) ?? 1;
  const result = await client.market.getPriceOverview(appid, marketHashName, { currency });
  outputJson(result);
  await client.close();
}

async function runSearch(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const query = args.positionals[1];
  if (query === undefined) {
    throw new Error("缺少参数,用法: amechan-steam search <query>");
  }
  const client = buildClient(context);
  const appid = getNumber(args, "appid");
  const count = getNumber(args, "count", 10) ?? 10;
  const result = await client.market.search({
    query,
    ...(appid !== undefined ? { appid } : {}),
    count,
  });
  outputJson({
    totalCount: result.total_count,
    results: result.results.map((r) => ({
      name: r.name,
      hash_name: r.hash_name,
      sell_price: r.sell_price,
      sell_listings: r.sell_listings,
      ...(r.app_name !== undefined ? { app_name: r.app_name } : {}),
    })),
  });
  await client.close();
}

async function runInventory(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const input = args.positionals[1];
  const appid = Number(args.positionals[2]);
  if (input === undefined || Number.isNaN(appid)) {
    throw new Error("缺少参数,用法: amechan-steam inventory <steamid|vanity|URL> <appid> [contextid]");
  }
  const contextId = getString(args, "contextid") ?? args.positionals[3] ?? "2";
  const client = buildClient(context);
  const language = getString(args, "language");
  const result = await client.inventory.getInventory(input, appid, contextId, {
    ...(language !== undefined ? { language } : {}),
  });
  outputJson({
    success: result.success,
    totalCount: result.total_inventory_count ?? result.assets.length,
    moreItems: result.more_items === 1,
    ...(result.last_assetid !== undefined ? { lastAssetid: result.last_assetid } : {}),
    assets: result.assets.map((a) => ({ assetid: a.assetid, classid: a.classid, amount: a.amount })),
  });
  await client.close();
}

async function runMyListings(context: CliContext): Promise<void> {
  const client = buildClient(context);
  const result = await client.market.getMyListings();
  outputJson({
    totalCount: result.total_count,
    listings: result.listings.map((l) => ({
      listingid: l.listingid,
      appid: l.appid,
      market_hash_name: l.market_hash_name,
      price: l.price,
      ...(l.currencyid !== undefined ? { currencyid: l.currencyid } : {}),
      ...(l.time_created !== undefined ? { time_created: l.time_created } : {}),
    })),
  });
  await client.close();
}

async function runReviews(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const appid = Number(args.positionals[1]);
  if (Number.isNaN(appid)) {
    throw new Error("缺少参数,用法: amechan-steam reviews <appid>");
  }
  const client = buildClient(context);
  const filter = getString(args, "filter");
  const language = getString(args, "language");
  const numPerPage = getNumber(args, "count");
  const result = await client.store.getAppReviews(appid, {
    ...(filter === "recent" || filter === "updated" || filter === "all" ? { filter } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(numPerPage !== undefined ? { numPerPage } : {}),
  });
  outputJson({
    success: result.success,
    summary: result.query_summary,
    cursor: result.cursor,
    reviews: result.reviews.map((r) => ({
      author: r.author.steamid,
      language: r.language,
      votedUp: r.voted_up,
      votesUp: r.votes_up,
      timestampCreated: r.timestamp_created,
      text: r.review.slice(0, 300),
    })),
  });
  await client.close();
}

async function runRedeem(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const key = args.positionals[1];
  if (key === undefined) {
    throw new Error("缺少参数,用法: amechan-steam redeem <activation_key>");
  }
  const client = buildClient(context);
  const result = await client.redeem.redeemActivationKey(key);
  outputJson(result);
  await client.close();
}

/** 价格监控:即时价 + 订单簿 + 价格历史;--count>1 时按 --interval 轮询即时价。 */
async function runWatch(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const appid = Number(args.positionals[1]);
  const marketHashName = args.positionals[2];
  if (Number.isNaN(appid) || marketHashName === undefined) {
    throw new Error("缺少参数,用法: amechan-steam watch <appid> <market_hash_name>");
  }
  const client = buildClient(context);
  const currency = getNumber(args, "currency", 1) ?? 1;
  const count = getNumber(args, "count", 1) ?? 1;
  const intervalSeconds = getNumber(args, "interval", 30) ?? 30;

  const price = await client.market.getPriceOverview(appid, marketHashName, { currency });
  const orders = await client.market.getItemOrdersHistogram(appid, marketHashName, { currency });
  const history = await client.market.getPriceHistory(appid, marketHashName);
  const latest = history.prices.length > 0 ? history.prices[history.prices.length - 1] : undefined;
  outputJson({
    marketHashName,
    price,
    orderBook: {
      lowestSell: orders.lowest_sell_order,
      highestBuy: orders.highest_buy_order,
      sellCount: orders.sell_order_count,
      buyCount: orders.buy_order_count,
    },
    priceHistoryPoints: history.prices.length,
    ...(latest !== undefined ? { latestPrice: latest[1], latestVolume: latest[2] } : {}),
  });

  // 轮询模式:持续输出即时价快照。
  for (let i = 1; i < count; i += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalSeconds * 1000));
    const snapshot = await client.market.getPriceOverview(appid, marketHashName, {
      currency,
      noCache: true,
    });
    outputJson({ tick: i, at: new Date().toISOString(), ...snapshot });
  }
  await client.close();
}

function promptText(label: string): Promise<string> {
  return new Promise((resolvePromise) => {
    process.stdout.write(label);
    let data = "";
    const onData = (chunk: string): void => {
      data += chunk;
    };
    const finish = (value: string): void => {
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", finish);
      process.stdin.removeListener("error", onError);
      resolvePromise(value.trim());
    };
    const onError = (): void => finish(data);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", onData);
    process.stdin.on("end", () => finish(data));
    process.stdin.on("error", onError);
  });
}

main(process.argv.slice(2)).catch(handleCliError);
