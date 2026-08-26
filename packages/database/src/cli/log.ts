#!/usr/bin/env node
/**
 * sc-log CLI —— 日志查询工具。
 *
 * 从本地 SQLite 或远程 PostgreSQL 按条件查询日志(配合 DatabaseLogTransport 使用)。
 *
 * 参数:
 *   --local-path <path>  本地日志库路径(缺省自动探测 <配置根>/amechan/logs/<hostname>.db)
 *   --remote-url <url>  远程 PostgreSQL 连接串(如 postgresql://user:pass@host:5432/db)
 *   --level <name>      等级过滤:debug/info/warn/error(可重复,如 --level error --level warn)
 *   --device <hostname> 设备过滤(hostname 精确匹配)
 *   --namespace <ns>    命名空间过滤(子串匹配)
 *   --since <iso|Ns|Nm|Nh|Nd> 起始时间(ISO 或相对,如 1h=最近1小时)
 *   --until <iso>       结束时间(ISO)
 *   --keyword <kw>      关键词(在 message/data 模糊搜索)
 *   --limit <n>         返回条数(默认 100)
 *   --offset <n>        跳过条数(分页)
 *
 * 输出:JSON 数组(每条含 time/level/namespace/hostname/message/data)。
 */
import {
  getNumber,
  getString,
  handleCliError,
  outputJson,
  printHelp,
  parseArgs,
} from "@sakurachiyo0v0/cli-utils";
import { queryLogs, resolveLogRemoteUrl } from "../index.js";
import type { LogQueryOptions } from "../index.js";

const USAGE = "sc-log [options]";
const COMMANDS: Array<{ name: string; desc: string }> = [
  { name: "help", desc: "显示帮助" },
];
const OPTIONS = [
  { flag: "--local-path <path>", desc: "本地日志库路径(默认自动探测)" },
  { flag: "--remote-url <url>", desc: "远程 PostgreSQL 连接串" },
  { flag: "--level <name>", desc: "等级过滤(debug/info/warn/error,可重复)" },
  { flag: "--device <hostname>", desc: "设备过滤" },
  { flag: "--namespace <ns>", desc: "命名空间过滤(子串)" },
  { flag: "--since <time>", desc: "起始时间(ISO 或相对 30m/1h/1d)" },
  { flag: "--until <iso>", desc: "结束时间(ISO)" },
  { flag: "--keyword <kw>", desc: "关键词搜索(message/data)" },
  { flag: "--limit <n>", desc: "返回条数(默认 100)" },
  { flag: "--offset <n>", desc: "跳过条数" },
];

/** 解析相对时间:"30m"/"1h"/"2d" → Date;ISO 原样解析。 */
function parseSince(value: string | undefined): Date | undefined {
  if (value === undefined || value === "") return undefined;
  const m = /^(\d+)([mhd])$/u.exec(value);
  if (m !== null) {
    const n = Number(m[1]);
    const unit = m[2]!;
    const ms = unit === "m" ? n * 60_000 : unit === "h" ? n * 3_600_000 : n * 86_400_000;
    return new Date(Date.now() - ms);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** 解析 --level 多次出现的值。 */
function parseLevels(args: ReturnType<typeof parseArgs>): Array<"debug" | "info" | "warn" | "error"> {
  const values = (args as { values: Record<string, string> }).values;
  const levels: Array<"debug" | "info" | "warn" | "error"> = [];
  for (const [key, value] of Object.entries(values)) {
    if (key === "level") {
      const lower = value.toLowerCase();
      if (lower === "debug" || lower === "info" || lower === "warn" || lower === "error") {
        levels.push(lower);
      }
    }
  }
  return levels;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const first = args.positionals[0];
  if (first === "help" || args.flags.has("help")) {
    printHelp(USAGE, COMMANDS, OPTIONS);
    return;
  }

  // 本地库路径:仅显式 --local-path 时查本地;只传 --remote-url 时不碰本地。
  const explicitLocal = getString(args, "local-path");
  const localPath = explicitLocal !== undefined ? explicitLocal : undefined;
  // 远程:--remote-url 显式 > 环境变量 LOG_REMOTE_URL > config 加密域自动解析
  let remoteUrl = getString(args, "remote-url");
  if (remoteUrl === undefined) {
    remoteUrl = await resolveLogRemoteUrl();
  }
  const levels = parseLevels(args);
  const since = parseSince(getString(args, "since"));
  const device = getString(args, "device");
  const namespace = getString(args, "namespace");
  const until = getString(args, "until");
  const keyword = getString(args, "keyword");
  const limit = getNumber(args, "limit");
  const offset = getNumber(args, "offset");

  const options: LogQueryOptions = {
    ...(localPath !== undefined ? { localPath } : {}),
    ...(remoteUrl !== undefined ? { remoteUrl } : {}),
    ...(levels.length > 0 ? { level: levels } : {}),
    ...(device !== undefined ? { hostname: device } : {}),
    ...(namespace !== undefined ? { namespace } : {}),
    ...(since !== undefined ? { from: since.toISOString() } : {}),
    ...(until !== undefined ? { to: until } : {}),
    ...(keyword !== undefined ? { keyword } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  };

  if (options.localPath === undefined && options.remoteUrl === undefined) {
    throw new Error("需要指定 --local-path 或 --remote-url(或两者都查)");
  }

  const results = await queryLogs(options);
  outputJson(results);
}

main().catch((error: unknown) => {
  handleCliError(error);
});
