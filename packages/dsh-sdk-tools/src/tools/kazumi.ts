import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createAnimeClient } from "@sakurachiyo0v0/kazumi";
import type { Road } from "@sakurachiyo0v0/kazumi";
import type { KazumiConfig } from "../config.js";
import { describeError } from "../errors.js";
import { expandHome } from "../path.js";

/** 把线路映射成模型可读的稳定形状。 */
function summarizeRoad(road: Road): {
  name: string;
  episodes: Array<{ name: string; url: string }>;
} {
  return {
    name: road.name,
    episodes: road.data.map((url, index) => ({
      name: road.identifier[index] ?? `第${index + 1}集`,
      url,
    })),
  };
}

/** 注册 kazumi 工具(search / roads / episodes / download)。 */
export function applyKazumiTools(ctx: Context, config: KazumiConfig): () => void {
  const disposers: Array<() => void> = [];

  disposers.push(ctx.tools.register(defineTool({
    name: "kazumi_search",
    description:
      "按关键词在已配置的番剧规则中搜索(规则为 Kazumi 兼容 JSON,存放于规则目录,用户自行导入)。" +
      "返回带 [规则名] 前缀的标题与详情页 URL。搜索前请确认规则已配置(至少一个规则文件在规则目录)。",
    parameters: {
      keyword: {
        type: "string",
        required: true,
        description: "搜索关键词,如番剧名",
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
                name: { type: "string", required: true },
                src: { type: "string", required: true },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: "text",
        text:
          value.items.length === 0
            ? "无搜索结果"
            : `搜索到 ${value.items.length} 条结果:\n` +
              value.items.map((item) => `- ${item.name}\n  ${item.src}`).join("\n"),
      }],
    },
    async execute(args) {
      try {
        const client = createAnimeClient();
        const items = await client.search(args.keyword);
        return { items };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  })));

  disposers.push(ctx.tools.register(defineTool({
    name: "kazumi_roads",
    description:
      "查询番剧详情页的播放线路(每个线路含集数列表)。传入搜索结果(src)的详情页 URL。",
    parameters: {
      src: {
        type: "string",
        required: true,
        description: "详情页 URL(来自 kazumi_search 结果的 src 字段)",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          roads: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", required: true },
                episodes: {
                  type: "array",
                  required: true,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      name: { type: "string", required: true },
                      url: { type: "string", required: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: "text",
        text:
          value.roads.length === 0
            ? "无线路"
            : `共 ${value.roads.length} 条线路:\n` +
              value.roads
                .map((road) => `- ${road.name}(${road.episodes.length} 集): ${road.episodes[0]?.url ?? ""}`)
                .join("\n"),
      }],
    },
    async execute(args) {
      try {
        const client = createAnimeClient();
        const roads = await client.getRoads({ name: "", src: args.src });
        return { roads: roads.map(summarizeRoad) };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  })));

  disposers.push(ctx.tools.register(defineTool({
    name: "kazumi_download",
    description:
      "下载番剧单集(播放页 URL → m3u8 解析 → 分片下载 → ffmpeg 合并 mp4)。" +
      "url 来自 kazumi_roads 的 episodes.url,或直接是 m3u8 直链。下载是长操作,可通过取消中断。",
    parameters: {
      url: {
        type: "string",
        required: true,
        description: "播放页 URL 或 m3u8 直链(来自 kazumi_roads 的 episodes.url)",
      },
      name: {
        type: "string",
        description: "集数名(输出文件名);缺省用 'episode'",
      },
      rule: {
        type: "string",
        description: "规则名(决定 UA/Referer 头);缺省时从 URL 匹配规则",
      },
      output_dir: {
        type: "string",
        description: `下载目录,默认 ${config.outputDir}`,
      },
      no_ad_filter: {
        type: "boolean",
        description: "设为 true 关闭 discontinuity 广告过滤(默认开启)",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          filePath: { type: "string", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `下载完成 → ${value.filePath}`,
      }],
    },
    async execute(args, exec) {
      try {
        const client = createAnimeClient();
        const ruleName = args.rule ?? inferRuleFromUrl(args.url);
        const result = await client.download(
          { name: args.name ?? "episode", url: args.url },
          {
            outputDir: expandHome(args.output_dir ?? config.outputDir),
            rule: ruleName,
            ...(args.no_ad_filter === true ? { adFilter: false } : {}),
            onProgress: () => {
              if (exec.signal.aborted) {
                throw new Error("CANCELLED: 下载已取消");
              }
            },
          },
        );
        return { filePath: result.filePath };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  })));

  return () => { for (const dispose of disposers) dispose(); };
}

/** 从播放 URL 推断规则名(取 URL host 最接近的规则);找不到抛错。 */
function inferRuleFromUrl(url: string): string {
  const client = createAnimeClient();
  const rules = client.rules.list();
  let host: string | null = null;
  try {
    host = new URL(url).host;
  } catch {
    // 非 URL 输入,交给下载层报错
  }
  if (host) {
    const match = rules.find((name) => {
      try {
        const rule = client.rules.load(name);
        return new URL(rule.baseUrl).host === host;
      } catch {
        return false;
      }
    });
    if (match) return match;
  }
  throw new Error(`RULE_NOT_FOUND: 无法从 URL 推断规则(${url}),请显式传 --rule 或 rule 参数`);
}
