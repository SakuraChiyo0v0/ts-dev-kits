/**
 * 账号信息路由：验证「SDK 消费」链路。
 * 每次请求先远程同步登录态（回写本地缓存），保证「一次登录、全局配好」。
 * 取流/歌词/搜索均经 NeteaseMusicClient 门面（SDK 已补对应能力）。
 * 注意：Hono 的 .get 是不可变方法，必须链式调用。
 */
import { Hono } from "hono";
import { createNeteaseClient, type QualityLevel } from "@sakurachiyo0v0/netease-music";
import { createAuthNamespace, warmupAuth } from "../bootstrap.js";

/** 构造已预热登录态的网易云客户端。 */
function createClient() {
  return createNeteaseClient({ remote: createAuthNamespace() });
}

/** 批量下载任务（内存表，单实例够用）。 */
interface DownloadTask {
  total: number;
  done: number;
  current?: string;
  status: "running" | "done" | "error";
  error?: string;
}
const downloadTasks = new Map<string, DownloadTask>();

/** 下载历史记录（内存，最多 100 条）。 */
interface DownloadRecord {
  id: string;
  title: string;
  filePath: string;
  level: string;
  status: "done" | "error";
  time: string;
}
const downloadHistory: DownloadRecord[] = [];

function pushHistory(record: Omit<DownloadRecord, "id" | "time">): void {
  downloadHistory.unshift({ ...record, id: crypto.randomUUID(), time: new Date().toISOString() });
  if (downloadHistory.length > 100) downloadHistory.pop();
}

/** GET /api/account —— 登录状态 + 账号信息 + VIP + 歌单列表。 */
export const accountRoutes = new Hono()
  .get("/account", async (c) => {
    await warmupAuth("netease-music");
    const client = createClient();

    if (!client.isLoggedIn) {
      return c.json({ loggedIn: false });
    }

    try {
      const info = await client.getAccountInfo();
      const vip = await client.getVipInfo();
      const playlists = await client.getUserPlaylists();
      return c.json({
        loggedIn: true,
        account: {
          userId: info.userId,
          nickname: info.nickname,
          ...(info.avatarUrl !== undefined ? { avatarUrl: info.avatarUrl } : {}),
          ...(info.signature !== undefined ? { signature: info.signature } : {}),
        },
        vip: { isVip: vip.isVip, level: vip.level, vipType: vip.vipType },
        playlists: playlists.map((p) => ({
          id: p.id,
          name: p.name,
          trackCount: p.trackCount,
          specialType: p.specialType,
          ...(p.coverUrl !== undefined ? { coverUrl: p.coverUrl } : {}),
          ...(p.creatorName !== undefined ? { creatorName: p.creatorName } : {}),
        })),
      });
    } catch {
      return c.json({ loggedIn: false, error: "登录态已失效，请重新扫码登录" }, 401);
    }
  })
  /** GET /api/playlist?id=xxx —— 歌单详情（歌单名 + 歌曲清单）。 */
  .get("/playlist", async (c) => {
    const id = c.req.query("id");
    if (id === undefined) return c.json({ error: "missing id" }, 400);

    await warmupAuth("netease-music");
    const client = createClient();
    try {
      const parsed = await client.parse(`https://music.163.com/#/playlist?id=${id}`);
      const item = parsed.items[0];
      if (item === undefined) return c.json({ error: "playlist not found" }, 404);
      return c.json({
        id: item.id,
        title: item.title,
        ...(item.coverUrl !== undefined ? { coverUrl: item.coverUrl } : {}),
        tracks: (item.tracks ?? []).map((t) => ({
          id: t.id,
          title: t.title,
          ...(t.artists !== undefined ? { artists: t.artists } : {}),
          ...(t.album !== undefined ? { album: t.album } : {}),
          ...(t.durationMs !== undefined ? { durationMs: t.durationMs } : {}),
          ...(t.coverUrl !== undefined ? { coverUrl: t.coverUrl } : {}),
        })),
      });
    } catch {
      return c.json({ error: "获取歌单失败" }, 500);
    }
  })
  /** GET /api/stream?id=xxx —— 取播放流 URL（320k mp3），供前端 <audio> 播放。 */
  .get("/stream", async (c) => {
    const id = c.req.query("id");
    if (id === undefined) return c.json({ error: "missing id" }, 400);

    const validLevels: QualityLevel[] = ["standard", "higher", "exhigh", "lossless", "hires"];
    const levelParam = c.req.query("level") ?? "exhigh";
    const level = (validLevels as string[]).includes(levelParam)
      ? (levelParam as QualityLevel)
      : "exhigh";

    await warmupAuth("netease-music");
    const client = createClient();
    if (!client.isLoggedIn) return c.json({ error: "未登录" }, 401);
    try {
      const url = await client.getStreamUrl(id, level);
      return c.json({ url, level });
    } catch {
      return c.json({ error: "取流失败" }, 500);
    }
  })
  /** GET /api/lyric?id=xxx —— 获取 LRC 歌词（原文 + 翻译）。 */
  .get("/lyric", async (c) => {
    const id = c.req.query("id");
    if (id === undefined) return c.json({ error: "missing id" }, 400);

    await warmupAuth("netease-music");
    const client = createClient();
    if (!client.isLoggedIn) return c.json({ error: "未登录" }, 401);
    try {
      const lyric = await client.getLyric(id);
      return c.json({
        ...(lyric.original !== undefined ? { original: lyric.original } : {}),
        ...(lyric.translated !== undefined ? { translated: lyric.translated } : {}),
      });
    } catch {
      return c.json({ error: "获取歌词失败" }, 500);
    }
  })
  /** GET /api/search?q=xxx —— 搜索歌曲（单曲，type=1）。 */
  .get("/search", async (c) => {
    const q = c.req.query("q");
    if (q === undefined || q.trim() === "") return c.json({ songs: [] });

    await warmupAuth("netease-music");
    const client = createClient();
    try {
      const songs = await client.search(q.trim(), { limit: 30 });
      return c.json({
        songs: songs.map((s) => ({
          id: s.id,
          title: s.title,
          ...(s.artists.length > 0 ? { artists: s.artists } : {}),
          ...(s.album !== "" ? { album: s.album } : {}),
          ...(s.durationMs > 0 ? { durationMs: s.durationMs } : {}),
        })),
      });
    } catch {
      return c.json({ error: "搜索失败" }, 500);
    }
  })
  /** GET /api/song?id=xxx —— 歌曲详情（含封面），用于搜索结果补封面。 */
  .get("/song", async (c) => {
    const id = c.req.query("id");
    if (id === undefined) return c.json({ error: "missing id" }, 400);

    await warmupAuth("netease-music");
    const client = createClient();
    try {
      const info = await client.getSongInfo(id);
      return c.json({
        id: info.id,
        title: info.title,
        artists: info.artists,
        album: info.album,
        durationMs: info.durationMs,
        ...(info.coverUrl !== undefined ? { coverUrl: info.coverUrl } : {}),
      });
    } catch {
      return c.json({ error: "获取歌曲失败" }, 500);
    }
  })
  /** POST /api/like?id=xxx —— 红心收藏一首歌。 */
  .post("/like", async (c) => {
    const id = c.req.query("id");
    if (id === undefined) return c.json({ error: "missing id" }, 400);
    await warmupAuth("netease-music");
    const client = createClient();
    try {
      await client.likeSong(id);
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "红心失败" }, 500);
    }
  })
  /** POST /api/unlike?id=xxx —— 取消红心收藏。 */
  .post("/unlike", async (c) => {
    const id = c.req.query("id");
    if (id === undefined) return c.json({ error: "missing id" }, 400);
    await warmupAuth("netease-music");
    const client = createClient();
    try {
      await client.unlikeSong(id);
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "取消红心失败" }, 500);
    }
  })
  /** POST /api/playlist/create —— 创建歌单，返回新歌单 id。 */
  .post("/playlist/create", async (c) => {
    const body = await c.req.json<{ name?: unknown }>().catch(() => ({ name: undefined }));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") return c.json({ error: "歌单名不能为空" }, 400);
    await warmupAuth("netease-music");
    const client = createClient();
    try {
      const id = await client.createPlaylist({ name });
      return c.json({ id });
    } catch {
      return c.json({ error: "创建失败" }, 500);
    }
  })
  /** POST /api/download —— 下载到 NAS 本地目录（服务器端落盘，支持子路径）。 */
  .post("/download", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      id?: unknown;
      level?: unknown;
      path?: unknown;
    };
    const id = typeof body.id === "string" ? body.id : undefined;
    if (id === undefined) return c.json({ error: "missing id" }, 400);
    const level = typeof body.level === "string" ? body.level : "exhigh";
    // 子路径：去路径穿越（..）与首尾斜杠，防止越出下载根目录。
    const subPath = typeof body.path === "string" ? body.path.trim() : "";
    const safeSub = subPath.replace(/\.\./gu, "").replace(/^\/+|\/+$/gu, "");

    await warmupAuth("netease-music");
    const client = createClient();
    if (!client.isLoggedIn) return c.json({ error: "未登录" }, 401);
    try {
      const outputDir = process.env.DOWNLOAD_DIR ?? "/downloads";
      const finalDir = safeSub === "" ? outputDir : `${outputDir}/${safeSub}`;
      let title = id;
      try {
        const info = await client.getSongInfo(id);
        title = info.artists.length > 0 ? `${info.artists.join(",")} - ${info.title}` : info.title;
      } catch {
        // 标题获取失败不影响下载。
      }
      const result = await client.downloadByInput(id, {
        outputDir: finalDir,
        level: level as QualityLevel,
      });
      pushHistory({ title, filePath: result.filePath, level: result.level, status: "done" });
      return c.json({ filePath: result.filePath, level: result.level });
    } catch (error) {
      pushHistory({ title: id, filePath: "", level: level as QualityLevel, status: "error" });
      return c.json({ error: error instanceof Error ? error.message : "下载失败" }, 500);
    }
  })
  /** GET /api/download-file?id=xxx —— 下载到浏览器（本机），流式转发。 */
  .get("/download-file", async (c) => {
    const id = c.req.query("id");
    if (id === undefined) return c.json({ error: "missing id" }, 400);
    const levelParam = c.req.query("level") ?? "exhigh";
    const validLevels: QualityLevel[] = ["standard", "higher", "exhigh", "lossless", "hires"];
    const level = (validLevels as string[]).includes(levelParam)
      ? (levelParam as QualityLevel)
      : "exhigh";

    await warmupAuth("netease-music");
    const client = createClient();
    if (!client.isLoggedIn) return c.json({ error: "未登录" }, 401);
    try {
      const info = await client.getSongInfo(id);
      const url = await client.getStreamUrl(id, level);
      const resp = await fetch(url);
      if (!resp.ok || resp.body === null) return c.json({ error: "取流失败" }, 500);
      const ext = level === "lossless" || level === "hires" ? "flac" : "mp3";
      const artist = info.artists.join(",") || "unknown";
      const filename = encodeURIComponent(`${artist} - ${info.title}.${ext}`);
      return new Response(resp.body, {
        headers: {
          "content-type": resp.headers.get("content-type") ?? "audio/mpeg",
          "content-disposition": `attachment; filename*=UTF-8''${filename}`,
          ...(resp.headers.get("content-length") !== null
            ? { "content-length": resp.headers.get("content-length") ?? "" }
            : {}),
        },
      });
    } catch {
      return c.json({ error: "下载失败" }, 500);
    }
  })
  /** POST /api/download-batch —— 批量下载到 NAS，返回任务 id 供轮询进度。 */
  .post("/download-batch", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      ids?: unknown;
      path?: unknown;
      level?: unknown;
    };
    const ids = Array.isArray(body.ids)
      ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    if (ids.length === 0) return c.json({ error: "empty ids" }, 400);
    const level = typeof body.level === "string" ? body.level : "exhigh";
    const subPath = typeof body.path === "string" ? body.path.trim() : "";
    const safeSub = subPath.replace(/\.\./gu, "").replace(/^\/+|\/+$/gu, "");

    const taskId = crypto.randomUUID();
    const task: DownloadTask = { total: ids.length, done: 0, status: "running" };
    downloadTasks.set(taskId, task);

    void (async () => {
      try {
        await warmupAuth("netease-music");
        const client = createClient();
        const outputDir = process.env.DOWNLOAD_DIR ?? "/downloads";
        const finalDir = safeSub === "" ? outputDir : `${outputDir}/${safeSub}`;
        for (const id of ids) {
          task.current = id;
          try {
            await client.downloadByInput(id, { outputDir: finalDir, level: level as QualityLevel });
          } catch {
            // 单曲失败不阻断整批。
          }
          task.done += 1;
        }
        task.status = "done";
        pushHistory({
          title: `批量下载 ${ids.length} 首`,
          filePath: finalDir,
          level: level as QualityLevel,
          status: "done",
        });
      } catch (error) {
        task.status = "error";
        task.error = error instanceof Error ? error.message : String(error);
      }
    })();

    return c.json({ taskId });
  })
  /** GET /api/download-batch?id=xxx —— 查询批量下载进度。 */
  .get("/download-batch", (c) => {
    const id = c.req.query("id");
    if (id === undefined) return c.json({ error: "missing id" }, 400);
    const task = downloadTasks.get(id);
    if (task === undefined) return c.json({ error: "task not found" }, 404);
    return c.json({
      total: task.total,
      done: task.done,
      status: task.status,
      ...(task.error !== undefined ? { error: task.error } : {}),
    });
  })
  /** GET /api/download-history —— 下载历史（内存，倒序）。 */
  .get("/download-history", (c) => {
    return c.json({ records: downloadHistory });
  });
