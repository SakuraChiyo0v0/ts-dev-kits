import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createNeteaseClient } from "@sakurachiyo0v0/netease-music";
import type { MediaItem, UserPlaylistSummary } from "@sakurachiyo0v0/netease-music";
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

/** 歌单摘要 → 模型可读形状。 */
function summarizePlaylist(item: UserPlaylistSummary): {
  id: string;
  name: string;
  trackCount: number;
  specialType: number;
  subscribed: boolean;
  creatorName?: string;
} {
  return {
    id: item.id,
    name: item.name,
    trackCount: item.trackCount,
    specialType: item.specialType,
    subscribed: item.subscribed,
    ...item.creatorName !== undefined ? { creatorName: item.creatorName } : {},
  };
}

/** 注册 netease-music 工具(解析/下载/状态 + 账号/收藏/歌单管理)。 */
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
    description: "检查网易云音乐登录态是否有效。下载或操作收藏前若提示登录,先调用本工具确认状态。",
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

  ctx.tools.register(defineTool({
    name: "netease_levels",
    description: "查询单曲可下载的品质清单(按当前账号身份过滤)。下载前可用它确认可用品质,避免请求无权限的品质。",
    parameters: {
      id: {
        type: "string",
        required: true,
        description: "歌曲 id",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true },
          levels: { type: "array", required: true, items: { type: "string" } },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `歌曲 ${value.id} 可用品质:${value.levels.join(" / ") || "无(可能需登录或 VIP)"}`,
      }],
    },
    async execute(args) {
      try {
        const client = createNeteaseClient();
        const levels = await client.getAvailableLevels(args.id);
        return { id: args.id, levels };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_account",
    description: "获取当前登录的网易云账号信息(uid / 昵称 / 头像)。操作收藏与歌单前先确认登录态。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          userId: { type: "string", required: true },
          nickname: { type: "string", required: true },
          avatarUrl: { type: "string" },
          signature: { type: "string" },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `网易云账号:${value.nickname} (uid=${value.userId})`,
      }],
    },
    async execute() {
      try {
        const client = createNeteaseClient();
        const info = await client.getAccountInfo();
        return {
          userId: info.userId,
          nickname: info.nickname,
          ...info.avatarUrl !== undefined ? { avatarUrl: info.avatarUrl } : {},
          ...info.signature !== undefined ? { signature: info.signature } : {},
        };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_playlists",
    description: "获取当前账号的歌单列表(含'我喜欢的音乐' specialType=5 与订阅的他人歌单)。返回 id/名称/歌曲数/是否订阅。",
    parameters: {
      limit: { type: "number", description: "返回条数,默认 30" },
      offset: { type: "number", description: "偏移量,默认 0(分页用)" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          playlists: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                name: { type: "string", required: true },
                trackCount: { type: "number", required: true },
                specialType: { type: "number", required: true },
                subscribed: { type: "boolean", required: true },
                creatorName: { type: "string" },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `共 ${value.playlists.length} 个歌单:\n` + value.playlists.map((p) => (
          `- ${p.name} (id=${p.id}, ${p.trackCount} 首${p.subscribed ? ", 已订阅" : ""}${p.creatorName !== undefined ? `, 创建者 ${p.creatorName}` : ""})`
        )).join("\n"),
      }],
    },
    async execute(args) {
      try {
        const client = createNeteaseClient();
        const playlists = await client.getUserPlaylists({
          ...args.limit !== undefined ? { limit: args.limit } : {},
          ...args.offset !== undefined ? { offset: args.offset } : {},
        });
        return { playlists: playlists.map(summarizePlaylist) };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_likes",
    description: "获取当前账号红心(喜欢)歌曲的 id 列表。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ids: { type: "array", required: true, items: { type: "string" } },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `红心歌曲 ${value.ids.length} 首:\n${value.ids.join(", ")}`,
      }],
    },
    async execute() {
      try {
        const client = createNeteaseClient();
        const ids = await client.getLikeList();
        return { ids };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_check_liked",
    description: "批量检查歌曲是否已红心(喜欢)。返回每首歌的 liked 状态。注意:该接口有分钟级缓存延迟,刚红心/取消后立即查询可能返回旧值。",
    parameters: {
      track_ids: {
        type: "array",
        required: true,
        items: { type: "string" },
        description: "歌曲 id 列表",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          liked: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                liked: { type: "boolean", required: true },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: value.liked.map(({ id, liked }) => `${id}: ${liked ? "已红心" : "未红心"}`).join("\n"),
      }],
    },
    async execute(args) {
      try {
        const client = createNeteaseClient();
        const map = await client.checkLiked(args.track_ids);
        return { liked: [...map.entries()].map(([id, liked]) => ({ id, liked })) };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_like",
    description: "把一首歌加入红心(喜欢)收藏。操作的是当前登录账号自己的收藏。",
    parameters: {
      track_id: { type: "string", required: true, description: "歌曲 id" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: value.ok ? `已将歌曲 ${args.track_id} 加入红心收藏` : "操作失败",
      }],
    },
    async execute(args) {
      try {
        const client = createNeteaseClient();
        await client.likeSong(args.track_id);
        return { ok: true };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_unlike",
    description: "把一首歌从红心(喜欢)收藏移除。操作的是当前登录账号自己的收藏。",
    parameters: {
      track_id: { type: "string", required: true, description: "歌曲 id" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: value.ok ? `已将歌曲 ${args.track_id} 移出红心收藏` : "操作失败",
      }],
    },
    async execute(args) {
      try {
        const client = createNeteaseClient();
        await client.unlikeSong(args.track_id);
        return { ok: true };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_playlist_add",
    description: "向歌单添加歌曲(可多首)。操作的是当前登录账号自己的歌单。",
    parameters: {
      playlist_id: { type: "string", required: true, description: "歌单 id" },
      track_ids: {
        type: "array",
        required: true,
        items: { type: "string" },
        description: "要添加的歌曲 id 列表",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: value.ok ? `已向歌单 ${args.playlist_id} 添加 ${args.track_ids.length} 首歌曲` : "操作失败",
      }],
    },
    async execute(args) {
      try {
        const client = createNeteaseClient();
        await client.addTracksToPlaylist(args.playlist_id, args.track_ids);
        return { ok: true };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_playlist_remove",
    description: "从歌单移除歌曲(可多首)。操作的是当前登录账号自己的歌单。",
    parameters: {
      playlist_id: { type: "string", required: true, description: "歌单 id" },
      track_ids: {
        type: "array",
        required: true,
        items: { type: "string" },
        description: "要移除的歌曲 id 列表",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: value.ok ? `已从歌单 ${args.playlist_id} 移除 ${args.track_ids.length} 首歌曲` : "操作失败",
      }],
    },
    async execute(args) {
      try {
        const client = createNeteaseClient();
        await client.removeTracksFromPlaylist(args.playlist_id, args.track_ids);
        return { ok: true };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_playlist_subscribe",
    description: "收藏(订阅)一个歌单。操作的是当前登录账号自己的收藏。",
    parameters: {
      playlist_id: { type: "string", required: true, description: "歌单 id" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: value.ok ? `已收藏歌单 ${args.playlist_id}` : "操作失败",
      }],
    },
    async execute(args) {
      try {
        const client = createNeteaseClient();
        await client.subscribePlaylist(args.playlist_id);
        return { ok: true };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_playlist_unsubscribe",
    description: "取消收藏(退订)一个歌单。操作的是当前登录账号自己的收藏。",
    parameters: {
      playlist_id: { type: "string", required: true, description: "歌单 id" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: value.ok ? `已取消收藏歌单 ${args.playlist_id}` : "操作失败",
      }],
    },
    async execute(args) {
      try {
        const client = createNeteaseClient();
        await client.unsubscribePlaylist(args.playlist_id);
        return { ok: true };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_playlist_create",
    description: "创建新歌单,返回新歌单 id。privacy: 0 普通,10 隐私。",
    parameters: {
      name: { type: "string", required: true, description: "歌单名称" },
      privacy: { type: "number", description: "0 普通(默认),10 隐私" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          playlistId: { type: "string", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `已创建歌单「${args.name}」(id=${value.playlistId})`,
      }],
    },
    async execute(args) {
      try {
        const client = createNeteaseClient();
        const playlistId = await client.createPlaylist({
          name: args.name,
          ...args.privacy !== undefined ? { privacy: args.privacy } : {},
        });
        return { playlistId };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: "netease_playlist_delete",
    description: "删除歌单。操作的是当前登录账号自己的歌单。",
    parameters: {
      playlist_id: { type: "string", required: true, description: "歌单 id" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: value.ok ? `已删除歌单 ${args.playlist_id}` : "操作失败",
      }],
    },
    async execute(args) {
      try {
        const client = createNeteaseClient();
        await client.deletePlaylist(args.playlist_id);
        return { ok: true };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  }));
}
