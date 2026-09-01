#!/usr/bin/env node
/**
 * sc-ugreen CLI：test / list / upload。
 * 连接参数（优先命令行，其次环境变量）：
 *   UGREEN_APP_HOST   — 应用网关地址
 *   UGREEN_PROXY_ID   — 应用 ID
 *   UGREEN_USERNAME   — 用户名
 *   UGREEN_PASSWORD   — 密码（推荐环境变量，避免出现在进程列表）
 *   UGREEN_BASE_DIR   — 默认目录
 */
import { readFileSync } from "node:fs";
import {
  CliError,
  getString,
  handleCliError,
  outputJson,
  printHelp,
  parseArgs,
} from "@sakurachiyo0v0/cli-utils";
import { createUgAppClient } from "../client.js";

const USAGE = "sc-ugreen <command> [options]";
const COMMANDS = [
  { name: "help", desc: "显示帮助" },
  { name: "test", desc: "连通性测试（登录 + 列默认目录）" },
  { name: "list [path]", desc: "列目录（默认 baseDir）" },
  { name: "upload <name>", desc: "上传文件（--file <本地路径> 或 --data <内容>）" },
];
const OPTIONS = [
  { flag: "--app-host <host>", desc: "应用网关地址（默认环境变量 UGREEN_APP_HOST）" },
  { flag: "--proxy-id <id>", desc: "应用 ID（默认 UGREEN_PROXY_ID）" },
  { flag: "--username <user>", desc: "用户名（默认 UGREEN_USERNAME）" },
  { flag: "--password <pass>", desc: "密码（默认 UGREEN_PASSWORD，推荐环境变量）" },
  { flag: "--base-dir <dir>", desc: "默认目录（默认 UGREEN_BASE_DIR）" },
  { flag: "--dir <dir>", desc: "upload/list 指定远端目录（默认 baseDir）" },
  { flag: "--file <path>", desc: "upload 从本地文件读内容" },
  { flag: "--data <text>", desc: "upload 直接给文本内容" },
];

function buildClient(args: ReturnType<typeof parseArgs>) {
  const appHost = getString(args, "app-host") ?? process.env.UGREEN_APP_HOST;
  const proxyId = getString(args, "proxy-id") ?? process.env.UGREEN_PROXY_ID;
  const username = getString(args, "username") ?? process.env.UGREEN_USERNAME;
  const password = getString(args, "password") ?? process.env.UGREEN_PASSWORD;
  if (!appHost || !proxyId || !username || !password) {
    throw new CliError("缺少连接参数：--app-host / --proxy-id / --username / --password（或环境变量 UGREEN_*）");
  }
  const baseDir = getString(args, "base-dir") ?? process.env.UGREEN_BASE_DIR;
  return createUgAppClient({
    appHost,
    proxyId,
    username,
    password,
    ...(baseDir !== undefined ? { baseDir } : {}),
  });
}

function requirePos(args: ReturnType<typeof parseArgs>, command: string): string {
  const v = args.positionals[1];
  if (v === undefined) throw new CliError(`${command} 需要位置参数`);
  return v;
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
    case "test": {
      const r = await client.test();
      if (!r.ok) {
        outputJson(r);
        process.exitCode = 1;
        return;
      }
      outputJson(r);
      return;
    }
    case "list": {
      const path = args.positionals[1];
      const r = await client.list(path);
      if (!r.ok) {
        outputJson(r);
        process.exitCode = 1;
        return;
      }
      outputJson(r);
      return;
    }
    case "upload": {
      const name = requirePos(args, "upload");
      const file = getString(args, "file");
      const data = getString(args, "data");
      let content: Buffer | string;
      if (file !== undefined) {
        content = readFileSync(file);
      } else if (data !== undefined) {
        content = data;
      } else {
        throw new CliError("upload 需要 --file <本地路径> 或 --data <内容>");
      }
      const dir = getString(args, "dir");
      const r = await client.upload(name, content, dir !== undefined ? { dirPath: dir } : undefined);
      if (!r.ok) {
        outputJson(r);
        process.exitCode = 1;
        return;
      }
      outputJson(r);
      return;
    }
    default:
      throw new CliError(`未知命令：${command}（用 sc-ugreen help 查看用法）`);
  }
}

run().catch(handleCliError);
