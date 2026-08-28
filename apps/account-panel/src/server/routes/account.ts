/**
 * 账号信息路由：验证「SDK 消费」链路。
 * 每次请求先远程同步登录态（回写本地缓存），保证「一次登录、全局配好」。
 * 取流/歌词/搜索均经 NeteaseMusicClient 门面（SDK 已补对应能力）。
 * 注意：Hono 的 .get 是不可变方法，必须链式调用。
 */
import { Hono } from "hono";
import { createNeteaseClient } from "@sakurachiyo0v0/netease-music";
import { createAuthNamespace, warmupAuth } from "../bootstrap.js";

/** 构造已预热登录态的网易云客户端。 */
function createClient() {
  return createNeteaseClient({ remote: createAuthNamespace() });
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

    await warmupAuth("netease-music");
    const client = createClient();
    if (!client.isLoggedIn) return c.json({ error: "未登录" }, 401);
    try {
      const url = await client.getStreamUrl(id, "exhigh");
      return c.json({ url, level: "exhigh" });
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
  });
