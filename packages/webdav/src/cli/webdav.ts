#!/usr/bin/env node
/**
 * amechan-webdav CLI:ping / list / get / put / delete / mkdir / rmdir / move / config-load / config-save。
 * 连接参数(优先命令行,其次环境变量):
 *   WEBDAV_URL       — WebDAV 地址
 *   WEBDAV_USERNAME  — 用户名
 *   WEBDAV_PASSWORD  — 密码(推荐用环境变量,避免出现在进程列表)
 */
import { readFileSync } from "node:fs";
import {
  CliError,
  getBool,
  getString,
  handleCliError,
  outputError,
  outputJson,
  outputText,
  printHelp,
  parseArgs,
} from "@sakurachiyo0v0/cli-utils";
import { createWebdavClient } from "../client.js";
import { createConfigStore } from "../config-store.js";
import { WebdavError } from "../errors.js";
import type { WebdavClient } from "../types.js";

const USAGE = "amechan-webdav <command> [options]";
const COMMANDS = [
  { name: "help", desc: "显示帮助" },
  { name: "ping", desc: "连通性检查" },
  { name: "list <path>", desc: "列目录(默认 /)" },
  { name: "get <path>", desc: "读文件内容" },
  { name: "put <path>", desc: "写文件(--file <本地路径> 或 --data <内容>)" },
  { name: "delete <path>", desc: "删文件/空目录" },
  { name: "mkdir <path>", desc: "建目录" },
  { name: "rmdir <path>", desc: "删目录" },
  { name: "move <src> <dst>", desc: "移动/重命名" },
  { name: "config-load <name>", desc: "读取配置(JSON 自动解析;--base-path --format)" },
  { name: "config-save <name>", desc: "保存配置(--file <本地> 或 --json <JSON>;--backup-count)" },
];
const OPTIONS = [
  { flag: "--url <url>", desc: "WebDAV 地址(默认环境变量 WEBDAV_URL)" },
  { flag: "--username <user>", desc: "用户名(默认 WEBDAV_USERNAME)" },
  { flag: "--password <pass>", desc: "密码(默认 WEBDAV_PASSWORD,推荐环境变量)" },
  { flag: "--file <path>", desc: "put/config-save 从本地文件读内容" },
  { flag: "--data <text>", desc: "put 直接给文本内容" },
  { flag: "--json <json>", desc: "config-save 直接给 JSON 对象" },
  { flag: "--base-path <dir>", desc: "config-* 远端目录(默认 /configs/)" },
  { flag: "--backup-count <n>", desc: "config-save 保留备份数(默认 3)" },
  { flag: "--raw", desc: "get 按文本原样输出(不 JSON 包裹)" },
];

function buildClient(args: ReturnType<typeof parseArgs>): WebdavClient {
  const url = getString(args, "url") ?? process.env.WEBDAV_URL;
  if (!url) {
    throw new CliError("缺少 WebDAV 地址: 传 --url 或设置环境变量 WEBDAV_URL");
  }
  const username = getString(args, "username") ?? process.env.WEBDAV_USERNAME;
  const password = getString(args, "password") ?? process.env.WEBDAV_PASSWORD;
  return createWebdavClient({
    url,
    ...(username !== undefined ? { username } : {}),
    ...(password !== undefined ? { password } : {}),
  });
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positionals[0];
  if (command === undefined || command === "help") {
    printHelp(USAGE, COMMANDS, OPTIONS);
    return;
  }
  const client = buildClient(args);

  switch (command) {
    case "ping": {
      await client.ping();
      outputJson({ ok: true, url: getString(args, "url") ?? process.env.WEBDAV_URL });
      return;
    }
    case "list": {
      const path = args.positionals[1] ?? "/";
      const entries = await client.list(path);
      outputJson(entries);
      return;
    }
    case "get": {
      const path = requirePos(args, "get");
      const content = await client.get(path);
      if (getBool(args, "raw")) {
        outputText(content);
      } else {
        outputJson({ path, content });
      }
      return;
    }
    case "put": {
      const path = requirePos(args, "put");
      const content = readContent(args);
      await client.put(path, content, { overwrite: true });
      outputJson({ ok: true, path });
      return;
    }
    case "delete": {
      const path = requirePos(args, "delete");
      await client.remove(path);
      outputJson({ ok: true, path });
      return;
    }
    case "mkdir": {
      const path = requirePos(args, "mkdir");
      await client.mkdir(path);
      outputJson({ ok: true, path });
      return;
    }
    case "rmdir": {
      const path = requirePos(args, "rmdir");
      await client.remove(path);
      outputJson({ ok: true, path });
      return;
    }
    case "move": {
      const src = requirePos(args, "move");
      const dst = args.positionals[2];
      if (!dst) throw new CliError("move 需要 <src> 和 <dst> 两个参数");
      await client.move(src, dst);
      outputJson({ ok: true, from: src, to: dst });
      return;
    }
    case "config-load": {
      const name = requirePos(args, "config-load");
      const store = createConfigStore({ client, ...configStoreOptions(args) });
      const data = await store.load(name);
      outputJson(data);
      return;
    }
    case "config-save": {
      const name = requirePos(args, "config-save");
      const store = createConfigStore({ client, ...configStoreOptions(args) });
      const file = getString(args, "file");
      const json = getString(args, "json");
      const data = file !== undefined ? readFileSync(file, "utf8") : json !== undefined ? JSON.parse(json) : readStdinOrThrow();
      await store.save(name, data);
      outputJson({ ok: true, name });
      return;
    }
    default:
      throw new CliError(`未知命令: ${command}(运行 amechan-webdav help 查看用法)`);
  }
}

function requirePos(args: ReturnType<typeof parseArgs>, command: string): string {
  const value = args.positionals[1];
  if (value === undefined) throw new CliError(`${command} 缺少路径参数`);
  return value;
}

function readContent(args: ReturnType<typeof parseArgs>): string {
  const file = getString(args, "file");
  if (file !== undefined) return readFileSync(file, "utf8");
  const data = getString(args, "data");
  if (data !== undefined) return data;
  throw new CliError("put 需要 --file <本地路径> 或 --data <内容>");
}

function readStdinOrThrow(): string {
  throw new CliError("config-save 需要 --file <本地路径> 或 --json <JSON>");
}

function configStoreOptions(args: ReturnType<typeof parseArgs>): { basePath?: string; backupCount?: number } {
  const basePath = getString(args, "base-path");
  const backup = getString(args, "backup-count");
  return {
    ...(basePath !== undefined ? { basePath } : {}),
    ...(backup !== undefined ? { backupCount: Number(backup) } : {}),
  };
}

run().catch((err: unknown) => {
  if (err instanceof WebdavError) {
    // 统一错误输出带错误码,便于排查(如 [AUTHENTICATION] [NOT_FOUND])
    outputError(`[${err.code}] ${err.message}`);
    process.exit(1);
  }
  handleCliError(err);
});
