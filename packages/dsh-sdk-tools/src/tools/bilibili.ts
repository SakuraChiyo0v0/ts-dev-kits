import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createBilibiliClient } from "@sakurachiyo0v0/bilibili";
import type { MediaItem } from "@sakurachiyo0v0/bilibili";
import type { BilibiliConfig } from "../config.js";
import { describeError } from "../errors.js";
import { expandHome } from "../path.js";

/** 把 MediaItem 映射成模型可读的稳定形状(不吐 raw)。 */
function summarizeItem(item: MediaItem): {
  type: string;
  id: string;
  title: string;
  duration?: number;
  ownerName?: string;
} {
  return {
    type: item.type,
    id: item.id,
    title: item.title,
    ...item.duration !== undefined ? { duration: item.duration } : {},
    ...item.owner !== undefined ? { ownerName: item.owner.name } : {},
  };
}

/** 注册 bilibili 工具(parse / download)。 */
export function applyBilibiliTools(ctx: Context, config: BilibiliConfig): void {
  ctx.tools.register(defineTool({
    name: "bilibili_parse",
    description: "解析一个 B 站链接(投稿视频/番剧/课程/音频等),返回媒体项列表。下载前先调用它确认链接可解析、拿到标题与类型。",
    parameters: {
      url: {
        type: "string",
        required: true,
        description: "B 站链接,如 https://www.bilibili.com/video/BV1xx411c7mD",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          items: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string", required: true },
                id: { type: "string", required: true },
                title: { type: "string", required: true },
                duration: { type: "number" },
                ownerName: { type: "string" },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `解析到 ${value.items.length} 个媒体项:\n` + value.items.map((item) => (
          `- [${item.type}] ${item.title} (id=${item.id}${item.duration !== undefined ? `, ${String(item.duration)}s` : ""}${item.ownerName !== undefined ? `, UP: ${item.ownerName}` : ""})`
        )).join("\n"),
      }],
    },
    async execute(args) {
      try {
        const client = createBilibiliClient();
        const items = await client.parse(args.url);
        return { items: items.map(summarizeItem) };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "bilibili_download",
    description: "下载一个 B 站视频/音频到本地。可先用 bilibili_parse 确认链接;未登录时高画质会失败并提示先扫码登录。下载是长操作,可通过取消中断。",
    parameters: {
      url: {
        type: "string",
        required: true,
        description: "B 站链接,如 https://www.bilibili.com/video/BV1xx411c7mD",
      },
      output_dir: {
        type: "string",
        description: `下载目录,默认 ${config.outputDir}`,
      },
      quality: {
        type: "number",
        description: "清晰度 id(如 64=360P, 80=1080P, 127=8K);高画质需登录",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          filePath: { type: "string", required: true },
          title: { type: "string", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `已下载《${value.title}》→ ${value.filePath}`,
      }],
    },
    async execute(args, exec) {
      try {
        const client = createBilibiliClient();
        const items = await client.parse(args.url);
        const first = items[0];
        if (first === undefined) {
          throw new Error("该链接没有可下载的媒体项");
        }
        const filePath = await client.download(first, {
          outputDir: expandHome(args.output_dir ?? config.outputDir),
          ...args.quality !== undefined ? { quality: args.quality } : {},
          onProgress: () => {
            if (exec.signal.aborted) {
              throw new Error("CANCELLED: 下载已取消");
            }
          },
        });
        return { filePath, title: first.title };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));
}
