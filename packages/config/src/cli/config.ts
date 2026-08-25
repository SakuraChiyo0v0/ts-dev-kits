#!/usr/bin/env node
/**
 * amechan-config CLI:setup / status / get / set / list / remove。
 * 全局配置(WebDAV 地址/账号/密钥)本地只配一次,各命名空间按需 --encrypt。
 */
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
import { WebdavError } from "@sakurachiyo0v0/webdav";
import { createConfigCenter } from "../config-center.js";
import { clearGlobalConfig, loadGlobalConfig, saveGlobalConfig } from "../global-config.js";
import type { GlobalConfig } from "../types.js";

const USAGE = "amechan-config <command> [options]";
const COMMANDS = [
  { name: "help", desc: "显示帮助" },
  { name: "setup", desc: "写入本地全局配置(--url/--username/--password/--key)" },
  { name: "status", desc: "查看全局配置状态(密码/密钥脱敏)" },
  { name: "get <namespace> <key>", desc: "读取配置(--encrypt 加密域)" },
  { name: "set <namespace> <key>", desc: "写入配置(--json 或 --file;--encrypt 加密)" },
  { name: "list <namespace>", desc: "列出命名空间下配置名(--encrypt)" },
  { name: "remove <namespace> <key>", desc: "删除配置(--encrypt)" },
  { name: "clear", desc: "清除本地全局配置" },
];
const OPTIONS = [
  { flag: "--url <url>", desc: "setup: WebDAV 地址" },
  { flag: "--username <user>", desc: "setup: 用户名" },
  { flag: "--password <pass>", desc: "setup: 密码(推荐环境变量)" },
  { flag: "--key <key>", desc: "setup: 加密密钥(也可用环境变量 WEBDAV_CONFIG_KEY)" },
  { flag: "--encrypt", desc: "get/set/list/remove: 操作加密域(默认明文域)" },
  { flag: "--json <json>", desc: "set: 直接给 JSON 对象" },
  { flag: "--file <path>", desc: "set: 从本地文件读内容" },
  { flag: "--config-path <path>", desc: "全局配置路径(默认 <配置根>/amechan/config.json)" },
];

function mask(value: string | undefined): string {
  if (value === undefined || value.length === 0) return "";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positionals[0];
  if (command === undefined || command === "help") {
    printHelp(USAGE, COMMANDS, OPTIONS);
    return;
  }
  const configPath = getString(args, "config-path");

  switch (command) {
    case "setup": {
      const url = getString(args, "url");
      const username = getString(args, "username");
      const password = getString(args, "password");
      const key = getString(args, "key");
      const existing = safeLoad(configPath);
      const merged: GlobalConfig = {
        url: url ?? existing?.url ?? "",
        ...(username !== undefined
          ? { username }
          : existing?.username !== undefined
            ? { username: existing.username }
            : {}),
        ...(password !== undefined
          ? { password }
          : existing?.password !== undefined
            ? { password: existing.password }
            : {}),
        ...(key !== undefined ? { key } : existing?.key !== undefined ? { key: existing.key } : {}),
      };
      const path = saveGlobalConfig(merged, configPath);
      outputJson({ ok: true, path, url: merged.url });
      return;
    }
    case "status": {
      const config = safeLoad(configPath);
      if (config === undefined) {
        outputJson({ configured: false, message: "未配置,请运行 amechan-config setup" });
        return;
      }
      outputJson({
        configured: true,
        url: config.url,
        username: config.username ?? "",
        password: mask(config.password),
        key: mask(config.key),
      });
      return;
    }
    case "get":
    case "set":
    case "list":
    case "remove": {
      const center = createConfigCenter({ ...(configPath !== undefined ? { configPath } : {}) });
      const nsName = args.positionals[1];
      if (nsName === undefined) throw new CliError(`${command} 缺少 <namespace> 参数`);
      const encrypt = getBool(args, "encrypt");
      const ns = center.namespace(nsName, { encrypt });

      if (command === "get") {
        const key = requireKey(args, "get");
        const data = await ns.get(key);
        outputJson(data);
        return;
      }
      if (command === "set") {
        const key = requireKey(args, "set");
        const json = getString(args, "json");
        const file = getString(args, "file");
        if (json === undefined && file === undefined) {
          throw new CliError("set 需要 --json <JSON> 或 --file <本地路径>");
        }
        const data = json !== undefined ? JSON.parse(json) : await import("node:fs").then((fs) => fs.readFileSync(file!, "utf8"));
        await ns.set(key, data);
        outputJson({ ok: true, namespace: nsName, key, encrypt });
        return;
      }
      if (command === "list") {
        const names = await ns.list();
        outputJson(names);
        return;
      }
      const key = requireKey(args, "remove");
      await ns.remove(key);
      outputJson({ ok: true, namespace: nsName, key });
      return;
    }
    case "clear": {
      clearGlobalConfig(configPath);
      outputJson({ ok: true, message: "全局配置已清除" });
      return;
    }
    default:
      throw new CliError(`未知命令: ${command}(运行 amechan-config help 查看用法)`);
  }
}

function requireKey(args: ReturnType<typeof parseArgs>, command: string): string {
  const key = args.positionals[2];
  if (key === undefined) throw new CliError(`${command} 缺少 <key> 参数`);
  return key;
}

function safeLoad(configPath?: string): ReturnType<typeof loadGlobalConfig> | undefined {
  try {
    return loadGlobalConfig(configPath);
  } catch {
    return undefined;
  }
}

run().catch((err: unknown) => {
  if (err instanceof WebdavError) {
    outputError(`[${err.code}] ${err.message}`);
    process.exit(1);
  }
  handleCliError(err);
});
