/**
 * B 站模块路由：登录态/搜索/解析/取流/代理流/下载/历史/稍后再看/收藏夹/退出。
 * 登录态经 AuthStore(remote=配置中心加密域) 双写；客户端从该命名空间自动加载 cookie。
 */
import { Hono } from "hono";
import { createBilibiliClient, type BilibiliClient } from "@sakurachiyo0v0/bilibili";
import { AuthStore } from "@sakurachiyo0v0/account";
import { basename } from "node:path";
import { createAuthNamespace, warmupAuth } from "../bootstrap.js";
import { getDownloadManager, downloadRoot } from "../downloads.js";
import { appLogger } from "../logger.js";

/** 构造已预热登录态的 B 站客户端（自动从配置中心加密域加载 cookie）。 */
function createClient(): BilibiliClient {
  return createBilibiliClient({ remote: createAuthNamespace() });
}

/** B 站视频流 Referer（防盗链校验）。 */
const BILI_REFERER = "https://www.bilibili.com/";
const BILI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * proxy 出口 host 白名单：只允许代理 B 站自家视频/图片域名，
 * 防止把面板变成任意 URL 的开放代理（SSRF 出口）。
 * 匹配主域 + 子域（如 upos-sz-mirrorcos.bilivideo.com、i0.hdslb.com）。
 */
const PROXY_HOST_ALLOWLIST = [
  /(^|\.)bilivideo\.com$/u,
  /(^|\.)bilibili\.com$/u,
  /(^|\.)hdslb\.com$/u, // 封面/用户头像图片
];

/** 校验代理目标 URL 是否在白名单内；不在则返回错误原因（null = 允许）。 */
function proxyHostAllowed(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return "url 非法";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "仅支持 http(s)";
  if (PROXY_HOST_ALLOWLIST.some((re) => re.test(u.hostname))) return null;
  return `域名不在白名单：${u.hostname}`;
}

/** 清理子路径（去穿越 + 首尾斜杠）。 */
function safeSubdir(raw: string): string {
  return raw.replace(/\.\./gu, "").replace(/^\/+|\/+$/gu, "");
}

/** B 站图片统一升级为 https：避免用户经 https 访问面板时 http 图片被浏览器混合内容拦截。 */
function httpsImg(url?: string): string | undefined {
  if (url === undefined || url === "") return url;
  return url.replace(/^http:\/\//u, "https://");
}

/** 把媒体项映射为前端可用的视频摘要。 */
function mediaToJson(item: {
  id: string;
  bvid?: string;
  cid?: number;
  title: string;
  cover?: string;
  duration?: number;
  owner?: { mid: number; name: string };
  play?: number;
  pages?: Array<{ cid: number; page: number; part: string; duration: number }>;
}) {
  return {
    id: item.id,
    bvid: item.bvid ?? "",
    title: item.title,
    ...(item.cid !== undefined ? { cid: item.cid } : {}),
    ...(item.cover !== undefined ? { cover: httpsImg(item.cover) } : {}),
    ...(item.duration !== undefined ? { duration: item.duration } : {}),
    ...(item.owner !== undefined ? { owner: item.owner.name } : {}),
    ...(item.play !== undefined ? { play: item.play } : {}),
    ...(item.pages !== undefined && item.pages.length > 0
      ? {
          pages: item.pages.map((p) => ({ cid: p.cid, page: p.page, part: p.part, duration: p.duration })),
        }
      : {}),
  };
}

export const bilibiliRoutes = new Hono()
  /** GET /api/bilibili/account —— 登录态 + 用户信息。 */
  .get("/account", async (c) => {
    await warmupAuth("bilibili");
    const client = createClient();
    if (!client.isLoggedIn || client.currentMid === undefined) {
      return c.json({ loggedIn: false });
    }
    try {
      const card = await client.user.getCard(client.currentMid);
      return c.json({
        loggedIn: true,
        account: {
          mid: card.mid,
          nickname: card.name,
          ...(card.face !== undefined ? { avatarUrl: httpsImg(card.face) } : {}),
          ...(card.sign !== undefined ? { signature: card.sign } : {}),
          fans: card.fans,
          following: card.following,
          level: card.level,
          vip: card.vip,
        },
      });
    } catch {
      return c.json({ loggedIn: false, error: "登录态已失效，请重新扫码登录" }, 401);
    }
  })
  /** GET /api/bilibili/search?q=xxx —— 搜索投稿视频。 */
  .get("/search", async (c) => {
    const q = c.req.query("q");
    if (q === undefined || q.trim() === "") return c.json({ videos: [] });
    const page = Number(c.req.query("page") ?? "1");
    const client = createClient();
    try {
      const videos = await client.search.searchVideos(q.trim(), {
        page: Number.isFinite(page) && page > 0 ? page : 1,
        pageSize: 30,
      });
      return c.json({
        videos: videos.map((v) => ({
          bvid: v.bvid,
          aid: v.aid,
          title: v.title,
          ...(v.cover !== undefined ? { cover: httpsImg(v.cover) } : {}),
          ...(v.duration !== undefined ? { duration: v.duration } : {}),
          ...(v.play !== undefined ? { play: v.play } : {}),
          ...(v.danmaku !== undefined ? { danmaku: v.danmaku } : {}),
          ...(v.author !== undefined ? { author: v.author } : {}),
          ...(v.mid !== undefined ? { mid: v.mid } : {}),
        })),
      });
    } catch {
      return c.json({ error: "搜索失败" }, 500);
    }
  })
  /** GET /api/bilibili/popular —— 综合热门视频。 */
  .get("/popular", async (c) => {
    const client = createClient();
    try {
      const videos = await client.search.popularVideos({ ps: 30 });
      return c.json({
        videos: videos.map((v) => ({
          bvid: v.bvid,
          aid: v.aid,
          title: v.title,
          ...(v.cover !== undefined ? { cover: httpsImg(v.cover) } : {}),
          ...(v.duration !== undefined ? { duration: v.duration } : {}),
          ...(v.play !== undefined ? { play: v.play } : {}),
          ...(v.author !== undefined ? { author: v.author } : {}),
        })),
      });
    } catch {
      return c.json({ error: "获取热门失败" }, 500);
    }
  })
  /** GET /api/bilibili/recommend?freshIdx=0&freshIdx1h=0 —— 首页推荐信息流（WBI 签名，支持续拉）。 */
  .get("/recommend", async (c) => {
    const freshIdx = Number(c.req.query("freshIdx") ?? 0);
    const freshIdx1h = Number(c.req.query("freshIdx1h") ?? 0);
    const keepFollowOnly = c.req.query("keepFollowOnly") === "1";
    const client = createClient();
    try {
      const page = await client.search.recommendFeed({
        freshIdx: Number.isFinite(freshIdx) ? freshIdx : 0,
        freshIdx1h: Number.isFinite(freshIdx1h) ? freshIdx1h : 0,
        ps: 20,
        ...(keepFollowOnly ? { keepFollowOnly: true } : {}),
      });
      return c.json({
        videos: page.items.map((v) => ({
          bvid: v.bvid,
          aid: v.aid,
          title: v.title,
          ...(v.cover !== undefined ? { cover: httpsImg(v.cover) } : {}),
          ...(v.duration !== undefined ? { duration: v.duration } : {}),
          ...(v.play !== undefined ? { play: v.play } : {}),
          ...(v.danmaku !== undefined ? { danmaku: v.danmaku } : {}),
          ...(v.author !== undefined ? { author: v.author } : {}),
        })),
        freshIdx: page.freshIdx,
        freshIdx1h: page.freshIdx1h,
      });
    } catch {
      return c.json({ error: "获取推荐失败" }, 500);
    }
  })
  /** GET /api/bilibili/ranking?rid=0 —— 排行榜（rid 0=全站，其余为分区 tid）。 */
  .get("/ranking", async (c) => {
    const ridRaw = c.req.query("rid");
    const rid = Number(ridRaw ?? 0);
    const client = createClient();
    try {
      const videos = await client.search.ranking({ rid: Number.isFinite(rid) ? rid : 0 });
      return c.json({
        videos: videos.map((v) => ({
          bvid: v.bvid,
          aid: v.aid,
          title: v.title,
          ...(v.cover !== undefined ? { cover: httpsImg(v.cover) } : {}),
          ...(v.duration !== undefined ? { duration: v.duration } : {}),
          ...(v.play !== undefined ? { play: v.play } : {}),
          ...(v.danmaku !== undefined ? { danmaku: v.danmaku } : {}),
          ...(v.author !== undefined ? { author: v.author } : {}),
        })),
      });
    } catch {
      return c.json({ error: "获取排行榜失败" }, 500);
    }
  })
  /** GET /api/bilibili/weekly —— 每周必看：返回期数列表（不含内容）。 */
  .get("/weekly", async (c) => {
    const client = createClient();
    try {
      const episodes = await client.search.weeklyPopularList();
      return c.json({ episodes });
    } catch {
      return c.json({ error: "获取每周必看失败" }, 500);
    }
  })
  /** GET /api/bilibili/weekly/videos?number=xxx —— 每周必看：指定期数的视频列表。 */
  .get("/weekly/videos", async (c) => {
    const number = Number(c.req.query("number") ?? 0);
    if (!Number.isFinite(number) || number <= 0) return c.json({ error: "missing number" }, 400);
    const client = createClient();
    try {
      const videos = await client.search.weeklyPopularVideos({ number });
      return c.json({
        videos: videos.map((v) => ({
          bvid: v.bvid,
          aid: v.aid,
          title: v.title,
          ...(v.cover !== undefined ? { cover: httpsImg(v.cover) } : {}),
          ...(v.duration !== undefined ? { duration: v.duration } : {}),
          ...(v.play !== undefined ? { play: v.play } : {}),
          ...(v.author !== undefined ? { author: v.author } : {}),
        })),
      });
    } catch {
      return c.json({ error: "获取周榜视频失败" }, 500);
    }
  })
  /** GET /api/bilibili/live?page=1 —— 关注直播列表（只读）。 */
  .get("/live", async (c) => {
    const page = Number(c.req.query("page") ?? 1);
    const client = createClient();
    try {
      const data = await client.live.following({ page: Number.isFinite(page) ? page : 1, pageSize: 20 });
      return c.json({
        rooms: data.rooms.map((r) => ({
          roomid: r.roomid,
          liveStatus: r.liveStatus,
          ...(r.title !== undefined ? { title: r.title } : {}),
          ...(r.cover !== undefined ? { cover: httpsImg(r.cover) } : {}),
          ...(r.upName !== undefined ? { upName: r.upName } : {}),
          ...(r.upMid !== undefined ? { upMid: r.upMid } : {}),
          ...(r.liveTime !== undefined ? { liveTime: r.liveTime } : {}),
        })),
        liveCount: data.liveCount,
        totalPage: data.totalPage,
      });
    } catch {
      return c.json({ error: "获取直播列表失败" }, 500);
    }
  })
  /** GET /api/bilibili/liked?pn=1 —— 点赞过的视频（需登录）。 */
  .get("/liked", async (c) => {
    const pn = Number(c.req.query("pn") ?? 1);
    const client = createClient();
    try {
      const { items, count } = await client.search.likedVideos({ pn: Number.isFinite(pn) ? pn : 1, ps: 20 });
      return c.json({
        videos: items.map((v) => ({
          bvid: v.bvid,
          aid: v.aid,
          title: v.title,
          ...(v.cover !== undefined ? { cover: httpsImg(v.cover) } : {}),
          ...(v.duration !== undefined ? { duration: v.duration } : {}),
          ...(v.play !== undefined ? { play: v.play } : {}),
          ...(v.author !== undefined ? { author: v.author } : {}),
        })),
        count,
      });
    } catch {
      return c.json({ error: "获取点赞视频失败" }, 500);
    }
  })
  /** GET /api/bilibili/video?bvid=xxx —— 视频详情（含分P）。 */
  .get("/video", async (c) => {
    const bvid = c.req.query("bvid");
    if (bvid === undefined || bvid.trim() === "") return c.json({ error: "missing bvid" }, 400);
    const client = createClient();
    try {
      const items = await client.parse(`https://www.bilibili.com/video/${bvid.trim()}`);
      const first = items[0];
      if (first === undefined) return c.json({ error: "视频不存在" }, 404);
      return c.json({
        video: mediaToJson(first),
        ...(items.length > 1
          ? { parts: items.map((it) => mediaToJson(it)) }
          : {}),
      });
    } catch {
      return c.json({ error: "获取视频失败" }, 500);
    }
  })
  /** GET /api/bilibili/stream?bvid=xxx&cid=xxx —— 取播放流（DASH 音视频分离，返回经代理的 URL）。 */
  .get("/stream", async (c) => {
    const bvid = c.req.query("bvid");
    if (bvid === undefined || bvid.trim() === "") return c.json({ error: "missing bvid" }, 400);
    const cidParam = c.req.query("cid");
    const client = createClient();
    try {
      const items = await client.parse(`https://www.bilibili.com/video/${bvid.trim()}`);
      let item = items[0];
      if (item === undefined) return c.json({ error: "视频不存在" }, 404);
      if (cidParam !== undefined && items.length > 1) {
        const cid = Number(cidParam);
        item = items.find((it) => it.cid === cid) ?? item;
      }
      const streams = await client.getStreams(item);
      const videoStream = streams.videoStreams[0];
      const audioStream = streams.audioStreams[0];
      if (videoStream === undefined) return c.json({ error: "无可用视频流" }, 500);
      const proxy = (url: string) => `/api/bilibili/proxy?url=${encodeURIComponent(url)}`;
      return c.json({
        quality: streams.quality,
        dash: streams.dash,
        videoUrl: proxy(videoStream.urls[0] ?? ""),
        ...(audioStream !== undefined && audioStream.urls[0] !== undefined
          ? { audioUrl: proxy(audioStream.urls[0]) }
          : {}),
        ...(streams.timelength !== undefined ? { durationMs: streams.timelength } : {}),
        title: item.title,
      });
    } catch {
      return c.json({ error: "取流失败" }, 500);
    }
  })
  /** GET /api/bilibili/proxy?url=xxx —— 代理视频/音频流（补 Referer + 转发 Range，支持拖动进度条）。 */
  .get("/proxy", async (c) => {
    const url = c.req.query("url");
    if (url === undefined || url === "") return c.json({ error: "missing url" }, 400);
    // SSRF 防护：只允许代理 B 站自家域名（见 PROXY_HOST_ALLOWLIST）。
    const denied = proxyHostAllowed(url);
    if (denied !== null) return c.json({ error: `代理目标被拒绝：${denied}` }, 403);
    const range = c.req.header("range");
    try {
      const resp = await fetch(url, {
        headers: {
          "user-agent": BILI_UA,
          referer: BILI_REFERER,
          ...(range !== undefined && range !== "" ? { range } : {}),
        },
      });
      if (resp.body === null) return c.json({ error: "代理流失败" }, 500);
      const headers: Record<string, string> = {
        "content-type": resp.headers.get("content-type") ?? "application/octet-stream",
        "accept-ranges": "bytes",
      };
      const len = resp.headers.get("content-length");
      if (len !== null) headers["content-length"] = len;
      const contentRange = resp.headers.get("content-range");
      if (contentRange !== null) headers["content-range"] = contentRange;
      return new Response(resp.body, { status: resp.status, headers });
    } catch {
      return c.json({ error: "代理流失败" }, 500);
    }
  })
  /** POST /api/bilibili/download —— 下载到 NAS。body: { bvid, cid?, path?, quality? } */
  .post("/download", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      bvid?: unknown;
      cid?: unknown;
      path?: unknown;
    };
    const bvid = typeof body.bvid === "string" ? body.bvid.trim() : "";
    if (bvid === "") return c.json({ error: "missing bvid" }, 400);
    const safeSub = safeSubdir(typeof body.path === "string" ? body.path.trim() : "");

    await warmupAuth("bilibili");
    const client = createClient();
    if (!client.isLoggedIn) return c.json({ error: "未登录" }, 401);
    try {
      const items = await client.parse(`https://www.bilibili.com/video/${bvid}`);
      let item = items[0];
      if (item === undefined) return c.json({ error: "视频不存在" }, 404);
      if (typeof body.cid === "number" && items.length > 1) {
        item = items.find((it) => it.cid === body.cid) ?? item;
      }
      const outputDir = safeSub === "" ? downloadRoot() : `${downloadRoot()}/${safeSub}`;
      const filePath = await client.download(item, { outputDir });
      getDownloadManager("bilibili").record({ filename: basename(filePath), filePath, status: "done" });
      appLogger.info("bilibili download ok", { bvid, dir: safeSub, filePath });
      return c.json({ filePath });
    } catch (error) {
      getDownloadManager("bilibili").record({ filename: bvid, filePath: "", status: "error" });
      appLogger.error("bilibili download failed", { bvid, dir: safeSub, error });
      // 透传具体原因（如取流失败/网络超时），前端据此提示而不是笼统的「下载失败」。
      const message =
        error instanceof Error && error.message !== ""
          ? error.message
          : "下载失败";
      return c.json({ error: message }, 500);
    }
  })
  /** GET /api/bilibili/history —— 历史记录（B站 history/cursor ps 上限 20）。 */
  .get("/history", async (c) => {
    await warmupAuth("bilibili");
    const client = createClient();
    if (!client.isLoggedIn) return c.json({ error: "未登录" }, 401);
    try {
      const { list } = await client.data.listHistory({ ps: 20 });
      return c.json({
        items: list.map((h) => ({
          kid: h.kid,
          title: h.title,
          business: h.business,
          viewAt: h.viewAt,
          ...(h.progress !== undefined ? { progress: h.progress } : {}),
          ...(h.duration !== undefined ? { duration: h.duration } : {}),
          ...(h.authorName !== undefined ? { author: h.authorName } : {}),
          ...(h.cover !== undefined ? { cover: httpsImg(h.cover) } : {}),
          ...(h.uri !== undefined ? { uri: h.uri } : {}),
        })),
      });
    } catch {
      return c.json({ error: "获取历史失败" }, 500);
    }
  })
  /** POST /api/bilibili/history/clear —— 清空历史记录。 */
  .post("/history/clear", async (c) => {
    await warmupAuth("bilibili");
    const client = createClient();
    try {
      await client.data.clearHistory();
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "清空失败" }, 500);
    }
  })
  /** POST /api/bilibili/history/remove —— 删除单条历史。body: { kid } */
  .post("/history/remove", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { kid?: unknown };
    const kid = body.kid;
    if (kid === undefined) return c.json({ error: "missing kid" }, 400);
    await warmupAuth("bilibili");
    const client = createClient();
    try {
      await client.data.delHistory(String(kid));
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "删除失败" }, 500);
    }
  })
  /** GET /api/bilibili/watch-later —— 稍后再看列表。 */
  .get("/watch-later", async (c) => {
    await warmupAuth("bilibili");
    const client = createClient();
    if (!client.isLoggedIn) return c.json({ error: "未登录" }, 401);
    try {
      const items = await client.data.listToView();
      return c.json({
        items: items.map((t) => ({
          aid: t.aid,
          ...(t.bvid !== undefined ? { bvid: t.bvid } : {}),
          title: t.title,
          ...(t.cover !== undefined ? { cover: httpsImg(t.cover) } : {}),
          ...(t.duration !== undefined ? { duration: t.duration } : {}),
          ...(t.owner !== undefined ? { owner: t.owner.name } : {}),
        })),
      });
    } catch {
      return c.json({ error: "获取稍后再看失败" }, 500);
    }
  })
  /** POST /api/bilibili/watch-later/remove —— 从稍后再看移除。body: { aid } */
  .post("/watch-later/remove", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { aid?: unknown };
    const aid = body.aid;
    if (aid === undefined) return c.json({ error: "missing aid" }, 400);
    await warmupAuth("bilibili");
    const client = createClient();
    try {
      await client.data.removeToView(String(aid));
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "移除失败" }, 500);
    }
  })
  /** GET /api/bilibili/fav —— 收藏夹列表。 */
  .get("/fav", async (c) => {
    await warmupAuth("bilibili");
    const client = createClient();
    if (!client.isLoggedIn || client.currentMid === undefined) return c.json({ error: "未登录" }, 401);
    try {
      const folders = await client.fav.listCreatedFolders(client.currentMid);
      // B 站 /x/v3/fav/folder/created/list-all 的 cover 字段大多为空，
      // 对无封面的收藏夹取首条内容的封面补上（保证卡片有图）。
      const foldersWithCover = await Promise.all(
        folders.map(async (f) => {
          let cover = f.cover;
          if (cover === undefined || cover === "") {
            try {
              const page = await client.fav.listResources(f.id, { pn: 1, ps: 1 });
              cover = page.list[0]?.cover;
            } catch {
              // 单个收藏夹取首图失败不影响整体。
            }
          }
          return {
            id: f.id,
            fid: f.fid,
            title: f.title,
            mediaCount: f.mediaCount,
            ...(cover !== undefined && cover !== "" ? { cover: httpsImg(cover) } : {}),
          };
        }),
      );
      return c.json({ folders: foldersWithCover });
    } catch {
      return c.json({ error: "获取收藏夹失败" }, 500);
    }
  })
  /** GET /api/bilibili/fav/content?id=xxx —— 收藏夹内容。 */
  .get("/fav/content", async (c) => {
    const id = c.req.query("id");
    if (id === undefined) return c.json({ error: "missing id" }, 400);
    await warmupAuth("bilibili");
    const client = createClient();
    try {
      const page = await client.fav.listResources(id, { pn: 1, ps: 50 });
      appLogger.info("bilibili fav content", { mediaId: String(id), listLen: page.list.length, hasMore: page.hasMore });
      return c.json({
        items: page.list.map((it) => ({
          aid: it.id,
          bvid: it.bvid,
          title: it.title,
          ...(it.cover !== undefined ? { cover: httpsImg(it.cover) } : {}),
          ...(it.duration !== undefined ? { duration: it.duration } : {}),
          ...(it.upper !== undefined ? { owner: it.upper.name } : {}),
        })),
      });
    } catch {
      return c.json({ error: "获取收藏夹内容失败" }, 500);
    }
  })
  /** POST /api/bilibili/fav/add —— 收藏视频到收藏夹。body: { rid, aid } */
  .post("/fav/add", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { rid?: unknown; aid?: unknown };
    const rid = body.rid;
    const aid = body.aid;
    if (rid === undefined || aid === undefined) return c.json({ error: "参数错误" }, 400);
    await warmupAuth("bilibili");
    const client = createClient();
    try {
      await client.fav.addVideo(String(rid), [String(aid)]);
      appLogger.info("bilibili fav add ok", { rid: String(rid), aid: String(aid) });
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "收藏失败" }, 500);
    }
  })
  /** GET /api/bilibili/bangumi —— 追番/追剧列表。 */
  .get("/bangumi", async (c) => {
    await warmupAuth("bilibili");
    const client = createClient();
    if (!client.isLoggedIn || client.currentMid === undefined) {
      return c.json({ error: "未登录" }, 401);
    }
    try {
      const { list } = await client.creative.listFollowedSeasons({
        vmid: client.currentMid,
        ps: 30,
      });
      return c.json({
        items: list.map((s) => ({
          seasonId: s.seasonId,
          title: s.title,
          ...(s.cover !== undefined ? { cover: httpsImg(s.cover) } : {}),
          ...(s.newEp !== undefined ? { newEp: s.newEp } : {}),
          ...(s.seasonTypeName !== undefined ? { typeName: s.seasonTypeName } : {}),
          ...(s.url !== undefined ? { url: s.url } : {}),
        })),
      });
    } catch {
      return c.json({ error: "获取追番失败" }, 500);
    }
  })
  /** GET /api/bilibili/danmaku?cid=xxx&segment=n —— 获取视频弹幕（按 6 分钟分段拉取）。 */
  .get("/danmaku", async (c) => {
    const cidRaw = c.req.query("cid");
    if (cidRaw === undefined || cidRaw === "") return c.json({ error: "missing cid" }, 400);
    const cid = Number(cidRaw);
    if (!Number.isFinite(cid)) return c.json({ error: "invalid cid" }, 400);
    const segment = Math.max(0, Number(c.req.query("segment") ?? "0"));
    const client = createClient();
    try {
      const items = await client.danmaku.list(cid, Number.isFinite(segment) ? segment : 0);
      return c.json({
        items: items.map((d) => ({
          time: d.time,
          mode: d.mode,
          color: d.color,
          text: d.text,
        })),
      });
    } catch {
      return c.json({ error: "获取弹幕失败" }, 500);
    }
  })
  /** GET /api/bilibili/download-history —— B 站下载历史（按平台隔离）。 */
  .get("/download-history", (c) => {
    return c.json({ records: getDownloadManager("bilibili").history() });
  })
  /** POST /api/bilibili/download-history/clear —— 清空 B 站下载历史。 */
  .post("/download-history/clear", (c) => {
    getDownloadManager("bilibili").clearHistory();
    return c.json({ ok: true });
  })
  /** POST /api/bilibili/download-history/remove —— 删除单条 B 站下载历史。 */
  .post("/download-history/remove", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: unknown };
    const id = typeof body.id === "string" ? body.id : undefined;
    if (id === undefined) return c.json({ error: "missing id" }, 400);
    getDownloadManager("bilibili").removeHistory(id);
    return c.json({ ok: true });
  })
  /** POST /api/bilibili/logout —— 退出登录（清除登录态）。 */
  .post("/logout", async (c) => {
    try {
      await warmupAuth("bilibili");
      const store = new AuthStore({ platform: "bilibili", remote: createAuthNamespace() });
      await store.clear();
      appLogger.info("bilibili logout ok");
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "退出失败" }, 500);
    }
  });
