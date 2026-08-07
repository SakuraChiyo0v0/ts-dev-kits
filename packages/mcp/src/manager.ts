/**
 * MCP 客户端管理器 —— 作为 MCP 客户端连接外部 MCP server。
 * 支持 stdio（command/args）与 HTTP/SSE（url）两种传输。
 * 参考 hermes tools/mcp_tool.py 设计：工具名前缀、注入扫描、include/exclude 过滤。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { LlmTool } from "@amechan/llm";

/** MCP server 配置（mcp.json 生态格式：command/args = stdio，url = HTTP/SSE） */
export interface McpServerConfig {
  /** 逻辑名（唯一，用于工具名前缀） */
  name: string;
  /** stdio 模式：可执行命令 */
  command?: string;
  /** stdio 模式：参数 */
  args?: string[];
  /** stdio 模式：环境变量 */
  env?: Record<string, string>;
  /** HTTP/SSE 模式：端点 URL */
  url?: string;
  /** 工具过滤：include 白名单 / exclude 黑名单 */
  tools?: { include?: string[]; exclude?: string[] };
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

/** 单个 MCP 工具（已带 server 前缀） */
export interface McpToolInfo {
  /** 完整工具名（server_tool） */
  name: string;
  /** 描述 */
  description: string;
  /** JSON Schema 参数 */
  parameters: Record<string, unknown>;
  /** 所属 server */
  server: string;
}

/** 检查 MCP 工具描述是否含 prompt 注入模式（参考 hermes _scan_mcp_description） */
const INJECTION_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /ignore\s+(all\s+)?previous/i, reason: "试图覆盖先前指令" },
  { pattern: /disregard\s+(all\s+)?(your|prior|previous)/i, reason: "试图覆盖系统指令" },
  { pattern: /you\s+are\s+now\s+/i, reason: "试图改变助手身份" },
  { pattern: /system\s*(:|prompt)/i, reason: "伪装系统指令" },
];

/** 单个已连接的 MCP server */
interface ConnectedServer {
  config: McpServerConfig;
  client: Client;
  tools: Tool[];
  /** 注入扫描告警 */
  warnings: string[];
  /** 最近连接错误（连接失败时记录） */
  lastError?: string;
}

export class McpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpError";
  }
}

export class McpManager {
  #servers = new Map<string, ConnectedServer>();

  /** 所有已连接 server 的工具（含 server 前缀） */
  getTools(): LlmTool[] {
    const tools: LlmTool[] = [];
    for (const [, server] of this.#servers) {
      for (const tool of server.tools) {
        const fullName = `${server.config.name}_${tool.name}`;
        if (!isToolEnabled(server.config, tool.name)) continue;
        tools.push({
          name: fullName,
          description: tool.description || `MCP 工具 ${tool.name}（来自 ${server.config.name}）`,
          parameters: normalizeSchema(tool.inputSchema),
          execute: async (args) => {
            try {
              const result = await server.client.callTool({
                name: tool.name,
                arguments: args,
              });
              return formatMcpResult(result);
            } catch (e) {
              return `MCP 工具调用失败：${(e as Error).message}`;
            }
          },
        });
      }
    }
    return tools;
  }

  /** 已连接 server 的工具信息（含警告与错误） */
  listServers(): { name: string; toolCount: number; warnings: string[]; connected: boolean; error?: string }[] {
    return [...this.#servers.entries()].map(([name, s]) => ({
      name,
      toolCount: s.tools.filter((t) => isToolEnabled(s.config, t.name)).length,
      warnings: s.warnings,
      connected: !s.lastError,
      ...(s.lastError ? { error: s.lastError } : {}),
    }));
  }

  /** 按配置连接所有启用的 server */
  async connectAll(configs: McpServerConfig[]): Promise<void> {
    await this.disconnectAll();
    for (const config of configs) {
      if (config.enabled === false) continue;
      try {
        await this.connect(config);
      } catch (e) {
        // 记录失败状态，供 UI 展示（不中断其他 server 连接）
        console.warn(`[MCP] 连接 ${config.name} 失败:`, (e as Error).message);
        this.#servers.set(config.name, {
          config,
          client: null as unknown as Client,
          tools: [],
          warnings: [],
          lastError: (e as Error).message,
        });
      }
    }
  }

  /** 连接单个 server */
  async connect(config: McpServerConfig): Promise<void> {
    await this.disconnect(config.name);

    const transport = await createTransport(config);
    const client = new Client({ name: "@amechan/mcp", version: "0.1.0" });
    await client.connect(transport);

    // 工具发现
    const toolsResult = await client.listTools();
    const tools = toolsResult.tools ?? [];

    // 注入扫描
    const warnings: string[] = [];
    for (const tool of tools) {
      for (const { pattern, reason } of INJECTION_PATTERNS) {
        if (pattern.test(tool.description ?? "")) {
          warnings.push(`工具 ${tool.name} 描述可疑：${reason}`);
          break;
        }
      }
    }
    if (warnings.length > 0) {
      console.warn(`[MCP] ${config.name} 注入扫描告警:`, warnings);
    }

    this.#servers.set(config.name, { config, client, tools, warnings });
    console.info(`[MCP] 已连接 ${config.name}，发现 ${tools.length} 个工具`);
  }

  /** 断开单个 server */
  async disconnect(name: string): Promise<void> {
    const server = this.#servers.get(name);
    if (!server) return;
    try {
      await server.client.close();
    } catch {
      // 忽略关闭错误
    }
    this.#servers.delete(name);
  }

  /** 断开所有 */
  async disconnectAll(): Promise<void> {
    const names = [...this.#servers.keys()];
    await Promise.allSettled(names.map((n) => this.disconnect(n)));
    this.#servers.clear();
  }

  /** 单个 server 的连接状态 */
  isConnected(name: string): boolean {
    return this.#servers.has(name);
  }
}

/** 根据配置创建传输层（stdio 或 streamable HTTP） */
async function createTransport(
  config: McpServerConfig,
): Promise<import("@modelcontextprotocol/sdk/shared/transport.js").Transport> {
  if (config.url) {
    return new StreamableHTTPClientTransport(new URL(config.url));
  }
  if (config.command) {
    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      ...(config.env ? { env: config.env } : {}),
      stderr: "pipe",
    });
  }
  throw new McpError(`MCP server ${config.name} 缺少配置：需要 command（stdio）或 url（HTTP/SSE）`);
}

/** 工具是否启用（include 优先，无 include 时排除 exclude）参考 hermes isToolEnabled */
function isToolEnabled(config: McpServerConfig, toolName: string): boolean {
  const include = config.tools?.include;
  const exclude = config.tools?.exclude;
  if (include && include.length > 0) return include.includes(toolName);
  return !(exclude && exclude.includes(toolName));
}

/** 归一化 MCP inputSchema 为 LLM 工具参数（参考 hermes _convert_mcp_schema） */
function normalizeSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema === "object" && schema !== null) {
    return schema as Record<string, unknown>;
  }
  return { type: "object", properties: {} };
}

/** 格式化 MCP callTool 返回结果 */
function formatMcpResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (typeof result !== "object" || result === null) return String(result);
  const record = result as Record<string, unknown>;
  // MCP 标准返回 { content: [{ type: 'text', text: '...' }] }
  const content = record.content;
  if (Array.isArray(content)) {
    const parts = content
      .map((c) => {
        const item = c as Record<string, unknown>;
        if (item.type === "text" && typeof item.text === "string") return item.text;
        if (item.type === "image") return `[图片: ${String(item.data ?? "")}]`;
        return JSON.stringify(c);
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join("\n");
  }
  if (record.isError) return `错误：${JSON.stringify(record)}`;
  return JSON.stringify(result);
}
