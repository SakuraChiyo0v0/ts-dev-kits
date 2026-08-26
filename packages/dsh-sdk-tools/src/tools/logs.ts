/**
 * logs 日志查询工具 —— 把 @sakurachiyo0v0/database 的 queryLogs 包装为 agent 工具。
 *
 * 能力:按等级/设备/命名空间/关键词/时间区间查询日志,跨机聚合(服务器 PostgreSQL)。
 * 连接串不硬编码:remoteUrl 走 "auto"(从 WebDAV 加密配置自动解析)。
 */
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { queryLogs, resolveLogRemoteUrl } from "@sakurachiyo0v0/database";
import type { LogsConfig } from "../config.js";
import { describeError } from "../errors.js";

/** 注册 logs 日志查询工具。 */
export function applyLogsTools(ctx: Context, config: LogsConfig): () => void {
  const disposers: Array<() => void> = [];

  disposers.push(ctx.tools.register(defineTool({
    name: "logs_query",
    description:
      "查询 SDK 日志。支持按等级(debug/info/warn/error)、设备(hostname)、命名空间(如 bilibili)、关键词、时间区间过滤。" +
      "默认查远程(服务器 PostgreSQL,跨机聚合);查本机日志需 local 配置开启并传 device=本机主机名。" +
      "排障时先查 error/warn 级日志定位问题。",
    parameters: {
      level: {
        type: "string",
        description: "等级过滤:debug/info/warn/error;可多个用逗号分隔,如 'warn,error'",
      },
      device: {
        type: "string",
        description: "设备过滤(hostname 精确匹配,如 desktop-01);不传查全部设备",
      },
      namespace: {
        type: "string",
        description: "命名空间过滤(子串匹配,如 bilibili/account/netease-music)",
      },
      keyword: {
        type: "string",
        description: "关键词(message/data 模糊搜索)",
      },
      since: {
        type: "string",
        description: "起始时间:ISO(如 2026-08-26T00:00:00Z)或相对(30m/1h/1d)",
      },
      limit: {
        type: "number",
        description: "返回条数上限,默认 20",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          count: { type: "number", required: true },
          logs: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                time: { type: "string", required: true },
                level: { type: "string", required: true },
                hostname: { type: "string", required: true },
                namespace: { type: "string", required: true },
                message: { type: "string", required: true },
                data: { type: "string" },
              },
            },
          },
        },
      },
      render: (args, value) => {
        if (value.count === 0) {
          return [{ type: "text", text: "没有匹配的日志" }];
        }
        const lines = value.logs.map((l: { time: string; level: string; hostname: string; namespace: string; message: string }) =>
          `[${l.level}] ${l.hostname} ${l.namespace}: ${l.message} (${l.time})`,
        );
        return [{ type: "text", text: lines.join("\n") }];
      },
    },
    async execute(args) {
      try {
        // 远程连接串:config 加密域自动解析(不硬编码)
        const remoteUrl = config.remote ? await resolveLogRemoteUrl() : undefined;
        const localPath = config.local ? await resolveLocalPath() : undefined;

        const parsedLevel = typeof args.level === "string" && args.level !== ""
          ? args.level.split(",").map((s) => s.trim()).filter((s) => s === "debug" || s === "info" || s === "warn" || s === "error") as Array<"debug" | "info" | "warn" | "error">
          : undefined;
        const since = typeof args.since === "string" && args.since !== ""
          ? parseSince(args.since)
          : undefined;

        if (remoteUrl === undefined && localPath === undefined) {
          return { count: 0, logs: [] };
        }

        const rows = await queryLogs({
          ...(localPath !== undefined ? { localPath } : {}),
          ...(remoteUrl !== undefined ? { remoteUrl } : {}),
          ...(parsedLevel !== undefined && parsedLevel.length > 0 ? { level: parsedLevel } : {}),
          ...(typeof args.device === "string" && args.device !== "" ? { hostname: args.device } : {}),
          ...(typeof args.namespace === "string" && args.namespace !== "" ? { namespace: args.namespace } : {}),
          ...(typeof args.keyword === "string" && args.keyword !== "" ? { keyword: args.keyword } : {}),
          ...(since !== undefined ? { from: since } : {}),
          limit: typeof args.limit === "number" && args.limit > 0 ? args.limit : 20,
        });

        return {
          count: rows.length,
          logs: rows.map((r) => ({
            time: r.time,
            level: r.level,
            hostname: r.hostname,
            namespace: r.namespace,
            message: r.message,
            ...(r.data !== undefined && r.data !== null ? { data: r.data } : {}),
          })),
        };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  })));

  return () => { for (const dispose of disposers) dispose(); };
}

/** 解析相对时间("30m"/"1h"/"1d")或 ISO,返回 ISO 字符串。 */
function parseSince(value: string): string | undefined {
  const m = /^(\d+)([mhd])$/u.exec(value);
  if (m !== null) {
    const n = Number(m[1]);
    const unit = m[2]!;
    const ms = unit === "m" ? n * 60_000 : unit === "h" ? n * 3_600_000 : n * 86_400_000;
    return new Date(Date.now() - ms).toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** 本机本地日志库路径(与 database 包默认一致)。 */
async function resolveLocalPath(): Promise<string | undefined> {
  try {
    const { defaultLocalLogPath } = await import("@sakurachiyo0v0/database");
    const { hostname } = await import("node:os");
    return defaultLocalLogPath(hostname());
  } catch {
    return undefined;
  }
}
