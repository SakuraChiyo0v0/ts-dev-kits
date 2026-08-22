/**
 * 进程发现：在本机找到正在运行的英雄联盟客户端（LeagueClientUx.exe），
 * 读取其启动命令行参数，解析出 LCU 的 port / token / server。
 *
 * 真实实现依赖 Windows（tasklist + PowerShell Get-CimInstance），
 * 通过注入 ProcessReader 可在测试中替换为夹具。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { LolError } from "./errors.js";
import type { LcuConnectionInfo } from "./types.js";

const execFileAsync = promisify(execFile);

export interface ProcessReader {
  /** 返回所有 LeagueClientUx.exe 的 PID */
  findClientPids(): Promise<number[]>;
  /** 返回进程的完整命令行；进程不存在时返回 undefined */
  readCommandLine(pid: number): Promise<string | undefined>;
}

export interface DiscoveryOptions {
  /** 指定 PID 时只探测该进程 */
  pid?: number;
  /** 注入自定义进程读取器（测试用） */
  reader?: ProcessReader;
}

/** 解析命令行参数：--app-port / --remoting-auth-token / --rso_platform_id */
export function parseCommandLine(cmdline: string): {
  port?: number;
  token?: string;
  server?: string;
} {
  const portMatch = /--app-port=(\d+)/i.exec(cmdline);
  const tokenMatch = /--remoting-auth-token=([^\s"]+)/i.exec(cmdline);
  const serverMatch = /--rso_platform_id=([^\s"]+)/i.exec(cmdline);

  return {
    ...(portMatch?.[1] ? { port: Number(portMatch[1]) } : {}),
    ...(tokenMatch?.[1] ? { token: tokenMatch[1] } : {}),
    ...(serverMatch?.[1] ? { server: serverMatch[1] } : {}),
  };
}

const TASKLIST_FILTER = "imagename eq LeagueClientUx.exe";

/** Windows 默认进程读取器：tasklist 找 PID + PowerShell CIM 读命令行 */
export const windowsProcessReader: ProcessReader = {
  async findClientPids(): Promise<number[]> {
    const { stdout } = await execFileAsync("tasklist", ["/FI", TASKLIST_FILTER, "/NH"], {
      windowsHide: true,
    });
    const pids: number[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      // 形如: LeagueClientUx.exe  12345  Console  1  12,345 K
      const m = /LeagueClientUx\.exe\s+(\d+)/i.exec(line);
      if (m?.[1]) {
        pids.push(Number(m[1]));
      }
    }
    return pids;
  },

  async readCommandLine(pid: number): Promise<string | undefined> {
    const script =
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | ` +
      "Select-Object -ExpandProperty CommandLine";
    const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    const line = stdout.trim();
    return line.length > 0 ? line : undefined;
  },
};

/** 按 PID 解析出 LCU 连接信息；端口或 token 缺失视为失败 */
export async function getConnectionByPid(pid: number, reader: ProcessReader): Promise<LcuConnectionInfo> {
  const cmdline = await reader.readCommandLine(pid);
  if (!cmdline) {
    throw new LolError("DISCOVERY_FAILED", `无法读取进程 ${pid} 的命令行（客户端可能已退出）`);
  }
  const { port, token, server } = parseCommandLine(cmdline);
  if (!port || !token) {
    throw new LolError("DISCOVERY_FAILED", `进程 ${pid} 命令行缺少 --app-port 或 --remoting-auth-token`);
  }
  return {
    pid,
    port,
    token,
    ...(server ? { server } : {}),
  };
}

/**
 * 自动发现本机 LCU。找不到客户端抛 CLIENT_NOT_RUNNING；
 * 找到了但解析失败抛 DISCOVERY_FAILED。
 */
export async function discoverLcuClient(options: DiscoveryOptions = {}): Promise<LcuConnectionInfo> {
  const reader = options.reader ?? windowsProcessReader;

  if (options.pid !== undefined) {
    return getConnectionByPid(options.pid, reader);
  }

  let pids: number[];
  try {
    pids = await reader.findClientPids();
  } catch {
    throw new LolError("CLIENT_NOT_RUNNING", "未检测到英雄联盟客户端（LeagueClientUx.exe）");
  }

  const target = pids[0];
  if (!target) {
    throw new LolError("CLIENT_NOT_RUNNING", "未检测到英雄联盟客户端（LeagueClientUx.exe）");
  }

  try {
    return await getConnectionByPid(target, reader);
  } catch (error) {
    if (error instanceof LolError && error.code === "DISCOVERY_FAILED") {
      throw error;
    }
    throw new LolError("DISCOVERY_FAILED", "读取客户端进程信息失败", { cause: error });
  }
}

/** 腾讯国服平台标识（启用 SGP 通道） */
export const TENCENT_SERVERS = new Set([
  "HN1",
  "HN10",
  "BGP2",
  "NJ100",
  "GZ100",
  "CQ100",
  "TJ100",
  "TJ101",
]);

export function isTencentServer(server: string | undefined): boolean {
  return server !== undefined && TENCENT_SERVERS.has(server.toUpperCase());
}
