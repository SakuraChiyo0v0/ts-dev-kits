import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createNeteaseClient } from "@sakurachiyo0v0/netease-music";
import type { MediaItem } from "@sakurachiyo0v0/netease-music";
import type { NeteaseConfig } from "../config.js";
import { describeError } from "../errors.js";
import { expandHome } from "../path.js";

/** 把网易云 MediaItem 映射成模型可读的稳定形状。 */
function summarizeItem(item: MediaItem): {
  type: string;
  id: string;
  title: string;
  artists?: string[];
  durationMs?: number;
} {
  return {
    type: item.type,
    id: item.id,
    title: item.title,
    ...item.artists !== undefined && item.artists.length > 0 ? { artists: item.artists } : {},
    ...item.durationMs !== undefined ? { durationMs: item.durationMs } : {},
  };
}

/** 注册 netease-music 工具(parse / download / status)。 */
export function applyNeteaseTools(ctx: Context, config: NeteaseConfig): void {
  ctx.tools.register(defineTool({
    name: "netease_parse",
    description: "解析一个网易云音乐链接(单曲/歌单/专辑),返回歌曲清单。下载前先调用它确认链接可解析、拿到标题与歌手。",
    parameters: {
      url: {
        type: "string",
        required: true,
        description: "网易云链接,如 https://music.163.com/song?id=123456 或歌单/专辑链接",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          songs: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string", required: true },
                id: { type: "string", required: true },
                title: { type: "string", required: true },
                artists: { type: "array", items: { type: "string" } },
                durationMs: { type: "number" },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `解析到 ${value.songs.length} 首歌曲:\n` + value.songs.map((song) => (
          `- ${song.title}${song.artists !== undefined && song.artists.length > 0 ? ` / ${song.artists.join(", ")}` : ""} (id=${song.id})`
        )).join("\n"),
      }],
    },
    async execute(args) {
      try {
        const client = createNeteaseClient();
        const { songs } = await client.parse(args.url);
        return { songs: songs.map(summarizeItem) };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_download",
    description: "下载网易云音乐的歌曲/歌单/专辑。品质按账号权限裁决:无权限的品质会被拒绝(不降级),试听片段绝不落盘。下载是长操作,可通过取消中断。",
    parameters: {
      url: {
        type: "string",
        required: true,
        description: "网易云链接或歌曲 id,如 https://music.163.com/song?id=123456 或 123456",
      },
      level: {
        type: "string",
        description: `目标品质,默认 ${config.level};可选 standard/higher/exhigh/lossless/hires`,
      },
      output_dir: {
        type: "string",
        description: `下载目录,默认 ${config.outputDir}`,
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          filePath: { type: "string", required: true },
          level: { type: "string", required: true },
          lyricPath: { type: "string" },
          coverPath: { type: "string" },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `已下载(${value.level})→ ${value.filePath}${value.lyricPath !== undefined ? `\n歌词 → ${value.lyricPath}` : ""}${value.coverPath !== undefined ? `\n封面 → ${value.coverPath}` : ""}`,
      }],
    },
    async execute(args, exec) {
      try {
        const client = createNeteaseClient();
        const result = await client.downloadByInput(args.url, {
          ...args.output_dir !== undefined ? { outputDir: expandHome(args.output_dir) } : {},
          ...args.level !== undefined ? { level: args.level as "standard" | "higher" | "exhigh" | "lossless" | "hires" } : {},
          onProgress: () => {
            if (exec.signal.aborted) {
              throw new Error("CANCELLED: 下载已取消");
            }
          },
        });
        return {
          filePath: result.filePath,
          level: result.level,
          ...result.lyricPath !== undefined ? { lyricPath: result.lyricPath } : {},
          ...result.coverPath !== undefined ? { coverPath: result.coverPath } : {},
        };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_status",
    description: "检查网易云音乐登录态是否有效。下载前若提示登录,先调用本工具确认状态。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          loggedIn: { type: "boolean", required: true },
          detail: { type: "string" },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: value.loggedIn ? "网易云音乐登录态有效" : `未登录:${value.detail ?? "需要扫码登录"}`,
      }],
    },
    async execute() {
      try {
        const client = createNeteaseClient();
        await client.getVipInfo();
        return { loggedIn: true };
      } catch (error) {
        return { loggedIn: false, detail: describeError(error) };
      }
    },
  }));
}
