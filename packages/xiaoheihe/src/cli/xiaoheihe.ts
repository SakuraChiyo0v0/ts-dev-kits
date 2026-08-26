#!/usr/bin/env node
/**
 * sc-xiaoheihe CLI:login / status / logout / feed / link / comments / messages / user。
 * 环境变量注入(测试/自定义网关):
 *   AMECHAN_XIAOHEIHE_AUTH_PATH  — 覆盖登录态存储路径
 *   AMECHAN_XIAOHEIHE_BASE_URL   — 覆盖 base URL(mock 测试用)
 *   AMECHAN_XIAOHEIHE_COOKIE     — 直接注入 cookie 头(优先于 AuthStore)
 *   AMECHAN_XIAOHEIHE_DEVICE_ID  — device_id 公共参数
 */
import { getBool, getString, handleCliError, outputError, outputJson, outputText, printHelp, parseArgs } from "@sakurachiyo0v0/cli-utils";
import { writeFileSync } from "node:fs";
import { AuthStore, qrcodeLogin } from "@sakurachiyo0v0/account";
import { createXiaoheiheClient } from "../client.js";
import { xiaoheiheQrAdapter } from "../api/qrcode.js";
import { XiaoheiheError } from "../errors.js";

const USAGE = "sc-xiaoheihe <command> [options]";
const COMMANDS = [
  { name: "help", desc: "显示帮助" },
  { name: "login", desc: "扫码登录并持久化(--no-browser 关闭自动打开浏览器)" },
  { name: "status", desc: "显示登录状态" },
  { name: "logout", desc: "清除存储的登录态" },
  { name: "feed", desc: "首页帖子流" },
  { name: "link <id>", desc: "帖子详情 + 评论区(第 1 页)" },
  { name: "comments <id> [page]", desc: "帖子评论区翻页" },
  { name: "messages", desc: "@消息列表(需登录)" },
  { name: "user <id>", desc: "用户资料(需登录)" },
];
const OPTIONS = [
  { flag: "--auth-path <path>", desc: "登录态存储路径(默认平台配置目录)" },
  { flag: "--no-browser", desc: "login 不自动打开浏览器(仅打印二维码 URL)" },
  { flag: "--qr-image <path>", desc: "login 把二维码图片写入 <path>(供聊天/远程渠道展示);同时不自动打开浏览器" },
  { flag: "--json", desc: "JSON 输出(默认已 JSON 输出,保留兼容)" },
];

interface CliContext {
  authPath: string | undefined;
  baseUrl: string | undefined;
  cookie: string | undefined;
  deviceId: string | undefined;
}

function env(name: string): string | undefined {
  return process.env[name];
}

function resolveContext(): CliContext {
  return {
    authPath: env("AMECHAN_XIAOHEIHE_AUTH_PATH"),
    baseUrl: env("AMECHAN_XIAOHEIHE_BASE_URL"),
    cookie: env("AMECHAN_XIAOHEIHE_COOKIE"),
    deviceId: env("AMECHAN_XIAOHEIHE_DEVICE_ID"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positionals[0] ?? "help";
  const context = resolveContext();

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
    case "feed":
      await runFeed(context);
      break;
    case "link":
      await runLink(context, args);
      break;
    case "comments":
      await runComments(context, args);
      break;
    case "messages":
      await runMessages(context);
      break;
    case "user":
      await runUser(context, args);
      break;
    default:
      outputError(`Unknown command: ${command}`);
      printHelp(USAGE, COMMANDS, OPTIONS);
      process.exitCode = 1;
  }
}

async function runLogin(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const store = new AuthStore({
    platform: "xiaoheihe",
    ...(context.authPath !== undefined ? { path: context.authPath } : {}),
  });
  outputText(`登录态存储: ${store.path}`);
  const qrImage = getString(args, "qr-image");
  outputText(
    qrImage !== undefined
      ? `正在生成二维码,图片将写入 ${qrImage},请使用小黑盒 App 扫码...`
      : "正在生成二维码,请使用小黑盒 App 扫码...",
  );
  const result = await qrcodeLogin({
    adapter: xiaoheiheQrAdapter({
      ...(context.baseUrl !== undefined ? { baseUrl: context.baseUrl } : {}),
    }),
    store,
    autoOpenBrowser: getBool(args, "no-browser") || qrImage !== undefined ? false : true,
    ...(qrImage !== undefined ? { onQrCode: (dataUrl) => writeQrImage(qrImage, dataUrl) } : {}),
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
  const client = createXiaoheiheClient(clientOptions(context));
  try {
    const status = await client.auth.status();
    outputJson(status);
  } catch (error) {
    if (error instanceof XiaoheiheError && error.code === "LOGIN_REQUIRED") {
      outputJson({ loggedIn: false, message: "未登录,请运行 sc-xiaoheihe login" });
      return;
    }
    if (error instanceof XiaoheiheError && error.code === "AUTH_EXPIRED") {
      outputJson({ loggedIn: false, message: "登录态已失效,请重新登录" });
      return;
    }
    throw error;
  }
}

async function runLogout(context: CliContext): Promise<void> {
  const client = createXiaoheiheClient(clientOptions(context));
  await client.auth.logout();
  outputJson({ ok: true, message: "已清除本地登录态" });
}

async function runFeed(context: CliContext): Promise<void> {
  const client = createXiaoheiheClient(clientOptions(context));
  const links = await client.feeds.list();
  outputJson(
    links.map((link) => ({
      linkid: link.linkid,
      title: link.title,
      description: link.description ?? "",
    })),
  );
}

async function runLink(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const linkId = Number(args.positionals[1]);
  if (!Number.isFinite(linkId) || linkId <= 0) {
    throw new XiaoheiheError("INVALID_URL", "link 命令需要一个数字帖子 ID");
  }
  const client = createXiaoheiheClient(clientOptions(context));
  const detail = await client.links.getDetail({ linkId });
  outputJson({
    linkid: detail.linkId,
    title: detail.title,
    contents: detail.contents,
    comments: detail.comments.map((c) => ({
      commentid: c.commentid,
      userid: c.userid,
      username: c.user?.username ?? "",
      text: c.text,
    })),
    totalPage: detail.totalPage,
  });
}

async function runComments(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const linkId = Number(args.positionals[1]);
  const page = Number(args.positionals[2] ?? "1");
  if (!Number.isFinite(linkId) || linkId <= 0) {
    throw new XiaoheiheError("INVALID_URL", "comments 命令需要一个数字帖子 ID");
  }
  const client = createXiaoheiheClient(clientOptions(context));
  const detail = await client.links.getDetail({ linkId, page });
  outputJson({
    linkid: detail.linkId,
    page,
    comments: detail.comments.map((c) => ({
      commentid: c.commentid,
      userid: c.userid,
      username: c.user?.username ?? "",
      text: c.text,
    })),
  });
}

async function runMessages(context: CliContext): Promise<void> {
  const client = createXiaoheiheClient(clientOptions(context));
  const messages = await client.messages.listAt();
  outputJson(
    messages.map((m) => ({
      message_id: m.message_id,
      linkid: m.linkid ?? m.link?.linkid ?? 0,
      comment_a_id: m.comment_a_id,
      text: m.comment_a_text ?? m.link?.text ?? "",
      user: m.user_a?.nickname ?? m.user_a?.username ?? m.user?.nickname ?? m.user?.username ?? "",
      userid: m.userid_a,
    })),
  );
}

async function runUser(context: CliContext, args: ReturnType<typeof parseArgs>): Promise<void> {
  const userId = args.positionals[1];
  if (userId === undefined || userId === "") {
    throw new XiaoheiheError("INVALID_URL", "user 命令需要一个用户 ID");
  }
  const client = createXiaoheiheClient(clientOptions(context));
  const profile = await client.user.getProfile(userId);
  outputJson(profile ?? {});
}

function clientOptions(context: CliContext): Parameters<typeof createXiaoheiheClient>[0] {
  return {
    ...(context.authPath !== undefined ? { authPath: context.authPath } : {}),
    ...(context.baseUrl !== undefined ? { baseUrl: context.baseUrl } : {}),
    ...(context.cookie !== undefined ? { cookie: context.cookie } : {}),
    ...(context.deviceId !== undefined ? { deviceId: context.deviceId } : {}),
  };
}

/** 把二维码 data URL 写入 PNG 文件(供聊天/远程渠道展示给用户扫码)。 */
function writeQrImage(filePath: string, dataUrl: string): void {
  const base64 = dataUrl.split(",")[1];
  if (base64 === undefined) {
    throw new Error(`二维码图片格式异常: ${dataUrl.slice(0, 30)}`);
  }
  writeFileSync(filePath, Buffer.from(base64, "base64"));
  outputText(`二维码图片已写入: ${filePath}`);
}

main().catch((error) => {
  handleCliError(error);
  process.exit(1);
});
