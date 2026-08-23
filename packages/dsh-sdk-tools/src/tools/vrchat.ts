import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createVrchatClient } from "@sakurachiyo0v0/vrchat";
import type { VrchatConfig } from "../config.js";
import { describeError } from "../errors.js";

/** 用户摘要(不吐 raw 敏感字段)。 */
function summarizeUser(user: { id: string; username: string; displayName: string; statusDescription?: string; isFriend?: boolean }): {
  id: string;
  username: string;
  displayName: string;
  statusDescription?: string;
  isFriend?: boolean;
} {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    ...user.statusDescription !== undefined ? { statusDescription: user.statusDescription } : {},
    ...user.isFriend !== undefined ? { isFriend: user.isFriend } : {},
  };
}

/** 世界摘要。 */
function summarizeWorld(world: { id: string; name: string; authorName?: string; capacity?: number; occupants?: number; description?: string }): {
  id: string;
  name: string;
  authorName?: string;
  capacity?: number;
  occupants?: number;
  description?: string;
} {
  return {
    id: world.id,
    name: world.name,
    ...world.authorName !== undefined ? { authorName: world.authorName } : {},
    ...world.capacity !== undefined ? { capacity: world.capacity } : {},
    ...world.occupants !== undefined ? { occupants: world.occupants } : {},
    ...world.description !== undefined ? { description: world.description } : {},
  };
}

/** 注册 vrchat 工具(只读;登录态自动从本地 auth.json 加载)。 */
export function applyVrchatTools(ctx: Context, config: VrchatConfig): void {
  void config;
  ctx.tools.register(defineTool({
    name: "vrchat_whoami",
    description: "返回当前登录的 VRChat 账号信息(displayName、username、状态等)。需要本地已保存 VRChat 登录态(auth.json)。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true },
          username: { type: "string", required: true },
          displayName: { type: "string", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `当前账号:${value.displayName} (@${value.username})`,
      }],
    },
    async execute() {
      try {
        const client = await createVrchatClient();
        try {
          const me = await client.auth.currentUser();
          return { id: me.id, username: me.username, displayName: me.displayName };
        } finally {
          await client.close();
        }
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "vrchat_user",
    description: "按用户名或用户 ID 查询 VRChat 用户信息(displayName、username、id、好友关系等)。需本地登录态。",
    parameters: {
      username: {
        type: "string",
        required: true,
        description: "用户名或用户 ID(usr_ 开头),二选一",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true },
          username: { type: "string", required: true },
          displayName: { type: "string", required: true },
          statusDescription: { type: "string" },
          isFriend: { type: "boolean" },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `${value.displayName} (@${value.username}) id=${value.id}${value.isFriend !== undefined ? ` 好友=${value.isFriend ? "是" : "否"}` : ""}${value.statusDescription !== undefined ? ` 状态:${value.statusDescription}` : ""}`,
      }],
    },
    async execute(args) {
      try {
        const client = await createVrchatClient();
        try {
          const user = args.username.startsWith("usr_")
            ? await client.users.getById(args.username)
            : await client.users.getByUsername(args.username);
          return summarizeUser(user);
        } finally {
          await client.close();
        }
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "vrchat_worlds_search",
    description: "搜索 VRChat 世界(公开世界列表),返回世界名称、作者、容量、在线人数。需本地登录态(该端点需认证);搜索词为空时返回热门世界。",
    parameters: {
      query: {
        type: "string",
        description: "搜索关键词,可空(空 = 热门/精选世界)",
      },
      limit: {
        type: "number",
        description: "返回数量上限,默认 5,最大 10",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          worlds: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                name: { type: "string", required: true },
                authorName: { type: "string" },
                capacity: { type: "number" },
                occupants: { type: "number" },
                description: { type: "string" },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: value.worlds.length === 0
          ? "没有找到匹配的世界"
          : `找到 ${value.worlds.length} 个世界:\n` + value.worlds.map((w) => (
            `- ${w.name} (${w.id})${w.authorName !== undefined ? ` 作者:${w.authorName}` : ""}${w.capacity !== undefined ? ` 容量:${String(w.capacity)}` : ""}${w.occupants !== undefined ? ` 在线:${String(w.occupants)}` : ""}`
          )).join("\n"),
      }],
    },
    async execute(args) {
      try {
        const client = await createVrchatClient();
        try {
          const n = args.limit === undefined ? 5 : Math.min(Math.max(Math.floor(args.limit), 1), 10);
          const worlds = await client.worlds.search({
            ...args.query !== "" ? { search: args.query } : {},
            n,
          });
          return { worlds: worlds.map(summarizeWorld) };
        } finally {
          await client.close();
        }
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));
}
