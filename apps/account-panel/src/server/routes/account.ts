/**
 * 账号信息路由：验证「SDK 消费」链路。
 * 每次请求先远程同步登录态（回写本地缓存），保证「一次登录、全局配好」。
 * 取流/歌词/搜索均经 NeteaseMusicClient 门面（SDK 已补对应能力）。
 * 注意：Hono 的 .get 是不可变方法，必须链式调用。
 */
import { Hono } from "hono";
import { createNeteaseClient, type QualityLevel } from "@sakurachiyo0v0/netease-music";
import { AuthStore } from "@sakurachiyo0v0/account";
import { DownloadManager } from "@sakurachiyo0v0/media-downloader";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { createAuthNamespace, warmupAuth } from "../bootstrap.js";

/** 构造已预热登录态的网易云客户端。 */
function createClient() {
  return createNeteaseClient({ remote: createAuthNamespace() });
}

/** 解析并校验品质，白名单外回退 exhigh。 */
function parseLevel(value: unknown): QualityLevel {
  const valid: QualityLevel[] = ["standard", "higher", "exhigh", "lossless", "hires"];
  return typeof value === "string" && (valid as string[]).includes(value) ? (value as QualityLevel) : "exhigh";
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

/** 通用下载管理器（root = DOWNLOAD_DIR，管理目录列表与下载历史）。 */
let downloadManager: DownloadManager | null = null;
function getDownloadManager(): DownloadManager {
  if (downloadManager === null) {
    downloadManager = new DownloadManager({ root: process.env.DOWNLOAD_DIR ?? "/downloads" });
  }
  return downloadManager;
}

/** 已下载歌曲 id 集合（持久化到 .downloaded.json，与下载历史分开）。 */
const downloadedIds = new Set<string>();

function downloadedPath(): string {
  return `${process.env.DOWNLOAD_DIR ?? "/downloads"}/.downloaded.json`;
}

function loadDownloaded(): void {
  try {
    const p = downloadedPath();
    if (existsSync(p)) {
      const arr = JSON.parse(readFileSync(p, "utf8")) as unknown;
      if (Array.isArray(arr)) {
        for (const id of arr) {
          if (typeof id === "string") downloadedIds.add(id);
        }
      }
    }
  } catch {
    // 忽略。
  }
}

function saveDownloaded(): void {
  try {
    const p = downloadedPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify([...downloadedIds]), "utf8");
  } catch {
    // 忽略。
  }
}

loadDownloaded();

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

    const level = parseLevel(c.req.query("level") ?? "exhigh");

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
  /** POST /api/playlist/delete —— 删除歌单。 */
  .post("/playlist/delete", async (c) => {
    const body = await c.req.json<{ id?: unknown }>().catch(() => ({ id: undefined }));
    const id = typeof body.id === "string" ? body.id : undefined;
    if (id === undefined) return c.json({ error: "missing id" }, 400);
    await warmupAuth("netease-music");
    const client = createClient();
    try {
      await client.deletePlaylist(id);
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "删除失败" }, 500);
    }
  })
  /** POST /api/playlist/add —— 向歌单添加歌曲。 */
  .post("/playlist/add", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { playlistId?: unknown; trackIds?: unknown };
    const playlistId = typeof body.playlistId === "string" ? body.playlistId : undefined;
    const trackIds = Array.isArray(body.trackIds)
      ? (body.trackIds as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    if (playlistId === undefined || trackIds.length === 0) return c.json({ error: "参数错误" }, 400);
    await warmupAuth("netease-music");
    const client = createClient();
    try {
      await client.addTracksToPlaylist(playlistId, trackIds);
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "添加失败" }, 500);
    }
  })
  /** POST /api/playlist/update —— 更新歌单（重命名/描述/标签）。 */
  .post("/playlist/update", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      id?: unknown;
      name?: unknown;
      desc?: unknown;
      tags?: unknown;
    };
    const id = typeof body.id === "string" ? body.id : undefined;
    if (id === undefined) return c.json({ error: "missing id" }, 400);
    const name = typeof body.name === "string" ? body.name : undefined;
    const desc = typeof body.desc === "string" ? body.desc : undefined;
    const tags = Array.isArray(body.tags) ? (body.tags as unknown[]).filter((x): x is string => typeof x === "string") : undefined;
    await warmupAuth("netease-music");
    const client = createClient();
    try {
      await client.updatePlaylist(id, {
        ...(name !== undefined ? { name } : {}),
        ...(desc !== undefined ? { desc } : {}),
        ...(tags !== undefined ? { tags } : {}),
      });
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "更新失败" }, 500);
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
    const level = parseLevel(body.level);
    // 子路径：去路径穿越（..）与首尾斜杠，防止越出下载根目录。
    const subPath = typeof body.path === "string" ? body.path.trim() : "";
    const safeSub = subPath.replace(/\.\./gu, "").replace(/^\/+|\/+$/gu, "");

    await warmupAuth("netease-music");
    const client = createClient();
    if (!client.isLoggedIn) return c.json({ error: "未登录" }, 401);
    try {
      const outputDir = process.env.DOWNLOAD_DIR ?? "/downloads";
      const finalDir = safeSub === "" ? outputDir : `${outputDir}/${safeSub}`;
      const result = await client.downloadByInput(id, {
        outputDir: finalDir,
        level,
      });
      downloadedIds.add(id);
      saveDownloaded();
      getDownloadManager().record({ filename: basename(result.filePath), filePath: result.filePath, status: "done" });
      return c.json({ filePath: result.filePath, level: result.level });
    } catch (error) {
      getDownloadManager().record({ filename: id, filePath: "", status: "error" });
      return c.json({ error: error instanceof Error ? error.message : "下载失败" }, 500);
    }
  })
  /** GET /api/download-file?id=xxx —— 下载到浏览器（本机），流式转发。 */
  .get("/download-file", async (c) => {
    const id = c.req.query("id");
    if (id === undefined) return c.json({ error: "missing id" }, 400);
    const level = parseLevel(c.req.query("level") ?? "exhigh");

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
    const level = parseLevel(body.level);
    const subPath = typeof body.path === "string" ? body.path.trim() : "";
    const safeSub = subPath.replace(/\.\./gu, "").replace(/^\/+|\/+$/gu, "");

    await warmupAuth("netease-music");
    const preflightClient = createClient();
    if (!preflightClient.isLoggedIn) return c.json({ error: "未登录" }, 401);

    const taskId = crypto.randomUUID();
    const task: DownloadTask = { total: ids.length, done: 0, status: "running" };
    downloadTasks.set(taskId, task);

    void (async () => {
      try {
        const client = createClient();
        const outputDir = process.env.DOWNLOAD_DIR ?? "/downloads";
        const finalDir = safeSub === "" ? outputDir : `${outputDir}/${safeSub}`;
        const failed = new Set<string>();
        for (const id of ids) {
          task.current = id;
          try {
            await client.downloadByInput(id, { outputDir: finalDir, level });
          } catch {
            failed.add(id);
          }
          task.done += 1;
        }
        task.status = "done";
        for (const id of ids) {
          if (!failed.has(id)) downloadedIds.add(id);
        }
        saveDownloaded();
        getDownloadManager().record({
          filename: `批量下载 ${ids.length} 首（失败 ${failed.size}）`,
          filePath: finalDir,
          status: failed.size === ids.length ? "error" : "done",
        });
      } catch (error) {
        task.status = "error";
        task.error = error instanceof Error ? error.message : String(error);
      } finally {
        // 任务完成后延时清理，避免内存增长。
        setTimeout(() => downloadTasks.delete(taskId), 5 * 60 * 1000);
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
    return c.json({ records: getDownloadManager().history() });
  })
  /** POST /api/download-history/clear —— 清空下载历史。 */
  .post("/download-history/clear", (c) => {
    getDownloadManager().clearHistory();
    return c.json({ ok: true });
  })
  /** GET /api/downloaded?ids=a,b,c —— 查询哪些歌曲已下载。 */
  .get("/downloaded", (c) => {
    const idsParam = c.req.query("ids") ?? "";
    const ids = idsParam.split(",").filter((x) => x !== "");
    const downloaded = ids.filter((id) => downloadedIds.has(id));
    return c.json({ downloaded });
  })
  /** GET /api/liked —— 红心歌曲 id 列表。 */
  .get("/liked", async (c) => {
    await warmupAuth("netease-music");
    const client = createClient();
    try {
      const ids = await client.getLikeList();
      return c.json({ ids });
    } catch {
      return c.json({ error: "获取失败" }, 500);
    }
  })
  /** GET /api/recommend —— 每日推荐歌曲。 */
  .get("/recommend", async (c) => {
    await warmupAuth("netease-music");
    const client = createClient();
    if (!client.isLoggedIn) return c.json({ error: "未登录" }, 401);
    try {
      const songs = await client.getRecommendSongs();
      return c.json({
        songs: songs.map((s) => ({
          id: s.id,
          title: s.title,
          artists: s.artists,
          album: s.album,
          durationMs: s.durationMs,
          ...(s.coverUrl !== undefined ? { coverUrl: s.coverUrl } : {}),
        })),
      });
    } catch {
      return c.json({ error: "获取失败" }, 500);
    }
  })
  /** GET /api/recommend-playlists —— 每日推荐歌单。 */
  .get("/recommend-playlists", async (c) => {
    await warmupAuth("netease-music");
    const client = createClient();
    try {
      const playlists = await client.getRecommendPlaylists();
      return c.json({ playlists });
    } catch {
      return c.json({ error: "获取失败" }, 500);
    }
  })
  /** GET /api/personal-fm —— 私人 FM（每日电台）歌曲。 */
  .get("/personal-fm", async (c) => {
    await warmupAuth("netease-music");
    const client = createClient();
    if (!client.isLoggedIn) return c.json({ error: "未登录" }, 401);
    try {
      const songs = await client.getPersonalFm();
      return c.json({
        songs: songs.map((s) => ({
          id: s.id,
          title: s.title,
          artists: s.artists,
          album: s.album,
          durationMs: s.durationMs,
          ...(s.coverUrl !== undefined ? { coverUrl: s.coverUrl } : {}),
        })),
      });
    } catch {
      return c.json({ error: "获取失败" }, 500);
    }
  })
  /** GET /api/download-dirs?path=xxx —— 列出下载目录下某子目录的直接子目录名。 */
  .get("/download-dirs", (c) => {
    const path = c.req.query("path") ?? "";
    return c.json({ dirs: getDownloadManager().listDirs(path) });
  })
  /** POST /api/download-mkdir —— 在下载目录下创建文件夹。 */
  .post("/download-mkdir", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: unknown; name?: unknown };
    const path = typeof body.path === "string" ? body.path : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") return c.json({ error: "文件夹名不能为空" }, 400);
    try {
      const rel = getDownloadManager().createDir(path, name);
      return c.json({ path: rel });
    } catch {
      return c.json({ error: "创建失败" }, 500);
    }
  })
  /** POST /api/logout —— 退出登录（清除本地 + 远程 WebDAV 登录态）。 */
  .post("/logout", async (c) => {
    try {
      await warmupAuth("netease-music");
      const store = new AuthStore({ platform: "netease-music", remote: createAuthNamespace() });
      await store.clear();
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "退出失败" }, 500);
    }
  });
