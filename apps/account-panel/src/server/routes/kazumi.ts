/**
 * 番剧（Kazumi）模块路由：规则管理 / 搜索 / 线路 / 集数 / 下载。
 * kazumi 无需平台账号登录，靠规则文件聚合番剧源；规则目录持久化到 NAS（DOWNLOAD_DIR/kazumi/rules）。
 */
import { Hono } from "hono";
import {
  createAnimeClient,
  parseM3u8,
  PlaybackResolver,
  type AnimeClient,
  type AnimeRule,
  type Road,
} from "@sakurachiyo0v0/kazumi";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, join } from "node:path";
import { getDownloadManager, downloadRoot } from "../downloads.js";
import { appLogger } from "../logger.js";
import { resolveWithBrowser } from "../browser-resolver.js";
import { recordRuleSearch, recordRuleBandwidth, recordRuleDownload, recordRuleProbeFailure, recordRulePlay, rankedRuleNames, listRuleRankings, setUserScore, setRuleTags } from "../rule-rankings.js";

const execFileAsync = promisify(execFile);

/** 番剧规则目录（NAS 持久化）。 */
function rulesDir(): string {
  return join(downloadRoot(), "kazumi", "rules");
}

/**
 * 用 ffprobe 分析下载好的视频文件，返回真实分辨率与码率（失败返回 undefined，不阻塞）。
 * ffprobe 来自系统 PATH（Docker 镜像与 NAS 均预装 ffmpeg）。
 */
async function probeFile(filePath: string): Promise<{ resolution?: string; bitrate?: number } | undefined> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      "-select_streams", "v:0",
      filePath,
    ], { timeout: 10_000 });
    const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number; bit_rate?: string }> };
    const video = parsed.streams?.[0];
    if (video === undefined) return undefined;
    const bitrateNum = Number(video.bit_rate);
    return {
      ...(video.width !== undefined && video.height !== undefined
        ? { resolution: `${video.width}x${video.height}` }
        : {}),
      ...(Number.isFinite(bitrateNum) && bitrateNum > 0 ? { bitrate: bitrateNum } : {}),
    };
  } catch {
    return undefined;
  }
}

/** 构造番剧客户端（规则存 NAS）。 */
function createClient(): AnimeClient {
  return createAnimeClient({ rulesDir: rulesDir(), sync: false });
}

/**
 * 流式下载 mp4 直链到文件（浏览器兜底解析出的加密源直链）。
 * 返回文件路径；失败抛错。
 */
async function downloadMp4Direct(
  url: string,
  filePath: string,
  headers: Record<string, string>,
): Promise<string> {
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const resp = await fetch(url, { headers, redirect: "follow" });
  if (!resp.ok || resp.body === null) {
    throw new Error(`mp4 下载失败 HTTP ${resp.status}`);
  }
  await pipeline(resp.body, createWriteStream(filePath));
  return filePath;
}

/**
 * 下载单集：优先 SDK 静态解析（m3u8），失败回退浏览器解析。
 * 浏览器解析出的 mp4 直链走流式下载；m3u8 走 SDK 分片下载。
 */
async function downloadEpisode(options: {
  client: AnimeClient;
  rule: string;
  episode: { name: string; url: string };
  title: string;
  outputDir: string;
}): Promise<string> {
  const { client, rule, episode, title, outputDir } = options;
  const animeRule = await client.rules.load(rule);
  const headers = headersFor(animeRule);
  // 文件名：剧名.集名.mp4（与整部一致）。
  const safeTitle = (title !== "" ? `${title}.` : "") + episode.name;
  const cleanName = safeTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  const filePath = join(outputDir, `${cleanName}.mp4`);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(outputDir, { recursive: true });

  try {
    // 1. 先试 SDK 静态解析下载（m3u8 分片 + 合并）。
    const result = await client.download(episode, { outputDir, rule, adFilter: true, ...(title !== "" ? { title } : {}) });
    return result.filePath;
  } catch {
    // 2. 静态失败 → 浏览器解析加密源直链。
    const browserUrl = await resolveWithBrowser(episode.url, { timeoutMs: 25_000 });
    if (browserUrl === null) {
      throw new Error("无法解析播放地址（加密源且浏览器解析失败）");
    }
    appLogger.info("kazumi download via browser", { rule, url: browserUrl.slice(0, 120) });
    // 3. mp4 直链 → 流式下载；m3u8 直链 → 试 SDK 下载。
    if (/\.mp4(\?|$)/i.test(browserUrl)) {
      await downloadMp4Direct(browserUrl, filePath, headers);
      return filePath;
    }
    const result = await client.download(episode, {
      outputDir,
      rule,
      adFilter: true,
      ...(title !== "" ? { title } : {}),
    });
    return result.filePath;
  }
}

/** 从搜索结果名提取规则名前缀（"[规则名] 标题" → "规则名"）。 */
function ruleFromName(name: string): string {
  const m = /^\[([^\]]+)\]\s*/.exec(name);
  return m?.[1] ?? "";
}

/** 清理子路径（去穿越 + 首尾斜杠）。 */
function safeSubdir(raw: string): string {
  return raw.replace(/\.\./gu, "").replace(/^\/+|\/+$/gu, "");
}

/** 由规则构造请求头（user-agent + referer，绕过番剧源防盗链）。 */
function headersFor(rule: AnimeRule): Record<string, string> {
  return {
    "user-agent": rule.userAgent || "Mozilla/5.0 (compatible; kazumi-sdk)",
    ...(rule.referer !== "" ? { referer: rule.referer } : {}),
  };
}

/** 拉取文本（带超时）。 */
async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  const resp = await fetch(url, { headers, redirect: "follow" });
  if (!resp.ok) throw new Error(`请求失败 ${url} → HTTP ${resp.status}`);
  return resp.text();
}

/** 线路质量探测缓存：key = 规则名|第一集URL，TTL 10 分钟，避免每次打开详情都重复解析。 */
const roadQualityCache = new Map<string, { quality: RoadQuality | null; expiresAt: number }>();
const ROAD_QUALITY_TTL_MS = 10 * 60 * 1000;

/** 线路质量（最高码率变体）。 */
interface RoadQuality {
  bandwidth?: number;
  resolution?: string;
}

/**
 * 探测线路质量：解析第一集播放页 → master playlist，取最高码率变体的 BANDWIDTH/RESOLUTION。
 * 失败（加密源/JS 动态取流）返回 null 并缓存，避免反复探测。
 */
async function probeRoadQuality(
  episodeUrl: string,
  ruleName: string,
  client: AnimeClient,
): Promise<RoadQuality | null> {
  const cacheKey = `${ruleName}|${episodeUrl}`;
  const cached = roadQualityCache.get(cacheKey);
  if (cached !== undefined && cached.expiresAt > Date.now()) return cached.quality;
  try {
    const animeRule = await client.rules.load(ruleName);
    const resolver = new PlaybackResolver();
    const resolved = await resolver.resolve(episodeUrl, headersFor(animeRule), 8_000);
    const content = await fetchText(resolved.url, headersFor(animeRule));
    const parsed = parseM3u8(content);
    if (parsed.type !== "master" || parsed.variants === undefined || parsed.variants.length === 0) {
      roadQualityCache.set(cacheKey, { quality: null, expiresAt: Date.now() + ROAD_QUALITY_TTL_MS });
      // 播放页解析到了但拿不到 master playlist：该源播放/下载可能受限，记探测失败降权。
      void recordRuleProbeFailure(ruleName);
      return null;
    }
    const best = parsed.variants.reduce((a, b) => (b.bandwidth > a.bandwidth ? b : a));
    const quality: RoadQuality = {
      ...(best.bandwidth > 0 ? { bandwidth: best.bandwidth } : {}),
      ...(best.resolution !== undefined ? { resolution: best.resolution } : {}),
    };
    roadQualityCache.set(cacheKey, { quality, expiresAt: Date.now() + ROAD_QUALITY_TTL_MS });
    // 回写码率到规则排名统计（异步不阻塞探测）。
    if (best.bandwidth > 0) void recordRuleBandwidth(ruleName, best.bandwidth);
    return quality;
  } catch {
    roadQualityCache.set(cacheKey, { quality: null, expiresAt: Date.now() + ROAD_QUALITY_TTL_MS });
    // 播放页解析失败（加密源/JS 动态取流/网络失败）：记探测失败，降其排名避免被优先点到。
    void recordRuleProbeFailure(ruleName);
    return null;
  }
}

/** 重写 media m3u8：segment/key URI 替换为经 /seg 代理的 URL。 */
function rewriteM3u8(
  media: NonNullable<ReturnType<typeof parseM3u8>["media"]>,
  baseUrl: string,
  rule: string,
): string {
  const segProxy = (uri: string): string => {
    const abs = new URL(uri, baseUrl).toString();
    return `/api/kazumi/seg?url=${encodeURIComponent(abs)}&rule=${encodeURIComponent(rule)}`;
  };
  const lines: string[] = ["#EXTM3U", "#EXT-X-VERSION:3"];
  if (media.targetDuration > 0) lines.push(`#EXT-X-TARGETDURATION:${media.targetDuration}`);
  lines.push("#EXT-X-MEDIA-SEQUENCE:0");
  lines.push("#EXT-X-PLAYLIST-TYPE:VOD");
  let lastKeyUri = "";
  for (const segment of media.segments) {
    if (segment.key && segment.key.method !== "NONE" && segment.key.uri !== lastKeyUri) {
      lastKeyUri = segment.key.uri;
      const ivAttr = segment.key.iv ? `,IV=${segment.key.iv}` : "";
      lines.push(`#EXT-X-KEY:METHOD=AES-128,URI="${segProxy(segment.key.uri)}"${ivAttr}`);
    }
    lines.push(`#EXTINF:${segment.duration.toFixed(3)},`);
    lines.push(segProxy(segment.uri));
  }
  lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}

export const kazumiRoutes = new Hono()
  /** GET /api/kazumi/rule-rankings —— 规则动态排名（成功率/码率/综合分，降序）。 */
  .get("/rule-rankings", async (c) => {
    try {
      const rankings = await listRuleRankings();
      return c.json({ rankings });
    } catch {
      return c.json({ error: "读取排名失败" }, 500);
    }
  })
  /** POST /api/kazumi/rule-rankings/score —— 设置源的个人评分（-5~+5，水印/字幕等主观加减）。body: { rule, score } */
  .post("/rule-rankings/score", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { rule?: unknown; score?: unknown };
    const rule = typeof body.rule === "string" ? body.rule.trim() : "";
    const score = Number(body.score);
    if (rule === "" || !Number.isFinite(score)) return c.json({ error: "参数错误" }, 400);
    await setUserScore(rule, score);
    return c.json({ ok: true, score: Math.max(-5, Math.min(5, Math.round(score))) });
  })
  /** POST /api/kazumi/rule-rankings/tags —— 设置源的用户标签（覆盖式）。body: { rule, tags: string[] } */
  .post("/rule-rankings/tags", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { rule?: unknown; tags?: unknown };
    const rule = typeof body.rule === "string" ? body.rule.trim() : "";
    const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [];
    if (rule === "") return c.json({ error: "参数错误" }, 400);
    await setRuleTags(rule, tags);
    return c.json({ ok: true, tags });
  })
  /** GET /api/kazumi/rules —— 规则列表。 */
  .get("/rules", (c) => {
    try {
      const client = createClient();
      return c.json({ rules: client.rules.list() });
    } catch {
      return c.json({ error: "读取规则失败" }, 500);
    }
  })
  /** POST /api/kazumi/rules/add —— 添加规则（JSON 校验后落盘）。body: { json } */
  .post("/rules/add", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { json?: unknown };
    const json = body.json;
    if (typeof json !== "object" || json === null) return c.json({ error: "规则 JSON 无效" }, 400);
    try {
      const client = createClient();
      const name = await client.rules.add(json as Record<string, unknown>);
      return c.json({ ok: true, name });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "添加失败";
      return c.json({ error: msg }, 400);
    }
  })
  /** POST /api/kazumi/rules/validate —— 校验规则 JSON，返回错误列表。body: { json } */
  .post("/rules/validate", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { json?: unknown };
    const json = body.json;
    if (typeof json !== "object" || json === null) return c.json({ error: "规则 JSON 无效" }, 400);
    try {
      const client = createClient();
      const errors = client.rules.validateJson(json as Record<string, unknown>);
      return c.json({ valid: errors.length === 0, errors });
    } catch {
      return c.json({ error: "校验失败" }, 500);
    }
  })
  /** POST /api/kazumi/rules/remove —— 删除规则。body: { name } */
  .post("/rules/remove", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name : "";
    if (name === "") return c.json({ error: "missing name" }, 400);
    try {
      const client = createClient();
      await client.rules.remove(name);
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "删除失败" }, 500);
    }
  })
  /** GET /api/kazumi/search?q=xxx —— 搜索番剧（打全部规则）。 */
  .get("/search", async (c) => {
    const q = c.req.query("q");
    if (q === undefined || q.trim() === "") return c.json({ items: [] });
    const client = createClient();
    try {
      const items = await client.search(q.trim());
      return c.json({
        items: items.map((it) => ({
          name: it.name.replace(/^\[[^\]]+\]\s*/, ""),
          src: it.src,
          rule: ruleFromName(it.name),
        })),
      });
    } catch {
      return c.json({ error: "搜索失败（可能被验证码拦截）" }, 500);
    }
  })
  /** GET /api/kazumi/search/stream?q=xxx —— 流式搜索（SSE）：搜到一个源就推一批结果。 */
  .get("/search/stream", async (c) => {
    const q = c.req.query("q");
    if (q === undefined || q.trim() === "") return c.json({ error: "missing q" }, 400);
    const client = createClient();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (event: string, data: unknown) => {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        // 客户端断开时中止后台搜索。
        const signal = c.req.raw.signal;
        let done = false;
        const abort = () => {
          done = true;
          try {
            controller.close();
          } catch {
            // 已关闭则忽略。
          }
        };
        signal.addEventListener("abort", abort);
        try {
          // 全部规则按排名排序（高分在前），保证所有源都被搜索、高分源优先。
          const allRules = client.rules.list();
          const orderedRules = await rankedRuleNames(allRules);
          await client.searchStream(q.trim(), {
            signal,
            // 始终传完整规则列表（排序后），否则只搜有排名记录的源会漏掉其他源。
            rules: orderedRules,
            onBatch: (items) => {
              if (done) return;
              send("batch", {
                items: items.map((it) => ({
                  name: it.name.replace(/^\[[^\]]+\]\s*/, ""),
                  src: it.src,
                  rule: ruleFromName(it.name),
                })),
              });
            },
            onProgress: (doneCount, total) => {
              if (done) return;
              // 单独发 progress 事件：无结果源也推进进度，前端可展示「已搜 n/m 源」。
              send("progress", { done: doneCount, total });
            },
            onRuleResult: (ruleName, ok, latencyMs) => {
              // 回写规则排名统计（异步不阻塞流）。
              void recordRuleSearch(ruleName, ok, latencyMs);
            },
          });
          if (!done) send("done", {});
        } catch {
          if (!done) send("error", { message: "搜索失败（可能被验证码拦截）" });
        } finally {
          signal.removeEventListener("abort", abort);
          if (!done) {
            done = true;
            try {
              controller.close();
            } catch {
              // 忽略。
            }
          }
        }
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  })
  /** POST /api/kazumi/roads —— 获取线路。body: { src, rule } */
  .post("/roads", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { src?: unknown; rule?: unknown };
    const src = typeof body.src === "string" ? body.src : "";
    const rule = typeof body.rule === "string" ? body.rule : "";
    if (src === "" || rule === "") return c.json({ error: "参数错误" }, 400);
    const client = createClient();
    try {
      // 构造带规则前缀的 SearchItem，供 getRoads 内部推断规则。
      const roads = await client.getRoads({ name: `[${rule}]`, src });
      // 并发探测各线路质量（第一集播放页 → master playlist 最高码率），
      // 让用户在选择线路时就能事先看到码率/分辨率。失败（加密源）返回 null。
      const qualities = await Promise.all(
        roads.map((r) =>
          r.data[0] !== undefined && r.data[0] !== ""
            ? probeRoadQuality(r.data[0], rule, client)
            : Promise.resolve(null),
        ),
      );
      return c.json({
        roads: roads.map((r, i) => ({
          name: r.name,
          data: r.data,
          identifier: r.identifier,
          ...(qualities[i] !== null && qualities[i] !== undefined ? { quality: qualities[i] } : {}),
        })),
      });
    } catch {
      return c.json({ error: "获取线路失败" }, 500);
    }
  })
  /** POST /api/kazumi/episodes —— 获取集数。body: { src, rule, road } */
  .post("/episodes", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      src?: unknown;
      rule?: unknown;
      road?: unknown;
    };
    const src = typeof body.src === "string" ? body.src : "";
    const rule = typeof body.rule === "string" ? body.rule : "";
    const road = body.road as Road | undefined;
    if (src === "" || rule === "" || road === undefined || !Array.isArray(road.data)) {
      return c.json({ error: "参数错误" }, 400);
    }
    const client = createClient();
    try {
      const episodes = await client.getEpisodes({ name: `[${rule}]`, src }, road);
      return c.json({
        episodes: episodes.map((e) => ({ name: e.name, url: e.url })),
      });
    } catch {
      return c.json({ error: "获取集数失败" }, 500);
    }
  })
  /** POST /api/kazumi/download —— 下载单集到 NAS。body: { rule, name, url, path } */
  .post("/download", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      rule?: unknown;
      name?: unknown;
      url?: unknown;
      path?: unknown;
      title?: unknown;
    };
    const rule = typeof body.rule === "string" ? body.rule : "";
    const name = typeof body.name === "string" ? body.name : "";
    const url = typeof body.url === "string" ? body.url : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (rule === "" || url === "") return c.json({ error: "参数错误" }, 400);
    const safeSub = safeSubdir(typeof body.path === "string" ? body.path.trim() : "");

    const client = createClient();
    try {
      const outputDir = safeSub === "" ? downloadRoot() : `${downloadRoot()}/${safeSub}`;
      const filePath = await downloadEpisode({
        client,
        rule,
        episode: { name, url },
        title,
        outputDir,
      });
      // ffprobe 分析真实分辨率/码率，记录进下载历史并返回；同时回写规则排名（下载成功率/速率）。
      const probe = await probeFile(filePath);
      void recordRuleDownload(rule, true, probe?.bitrate ?? 0);
      getDownloadManager("kazumi").record({
        filename: basename(filePath),
        filePath,
        status: "done",
        ...(probe?.resolution !== undefined ? { resolution: probe.resolution } : {}),
        ...(probe?.bitrate !== undefined ? { bitrate: probe.bitrate } : {}),
      });
      appLogger.info("kazumi download ok", { rule, name, dir: safeSub, filePath, probe });
      return c.json({ filePath, ...(probe !== undefined ? { probe } : {}) });
    } catch (error) {
      void recordRuleDownload(rule, false, 0);
      getDownloadManager("kazumi").record({ filename: name || rule, filePath: "", status: "error" });
      appLogger.error("kazumi download failed", { rule, name, dir: safeSub, error });
      // 透传具体原因（如 STREAM_PARSE_FAILED = 加密源无法静态取流），前端据此提示。
      const message =
        error instanceof Error && error.message !== ""
          ? error.message
          : "下载失败";
      return c.json({ error: message }, 500);
    }
  })
  /**
   * POST /api/kazumi/download-all —— 整部番批量下载。
   * body: { rule, title, episodes: [{name,url}], path? }
   * 下载到 <DOWNLOAD_DIR>/kazumi/<title>/（或 path 指定子目录），文件名「title.集名.mp4」。
   * 单集失败不中断，返回 { done, failed, files }。
   */
  .post("/download-all", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      rule?: unknown;
      title?: unknown;
      episodes?: unknown;
      path?: unknown;
    };
    const rule = typeof body.rule === "string" ? body.rule : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (rule === "" || title === "") return c.json({ error: "参数错误" }, 400);
    const episodes = Array.isArray(body.episodes)
      ? body.episodes
          .filter((e): e is { name: unknown; url: unknown } => typeof e === "object" && e !== null)
          .map((e) => ({
            name: typeof e.name === "string" ? e.name : "",
            url: typeof e.url === "string" ? e.url : "",
          }))
          .filter((e) => e.name !== "" && e.url !== "")
      : [];
    if (episodes.length === 0) return c.json({ error: "没有可下载的集数" }, 400);
    const safeSub = safeSubdir(typeof body.path === "string" ? body.path.trim() : "");
    // 整部番默认放进 kazumi/<剧名>/ 文件夹（文件名已含剧名，目录也按剧名归类便于导入）。
    const baseDir = safeSub === "" ? join(downloadRoot(), "kazumi", title) : join(downloadRoot(), safeSub, title);
    const client = createClient();
    // SSE 流式进度：每集开始/完成/失败实时推送，前端可展示「正在下载第 x/N 集」「成功/失败」。
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // 客户端断开。
          }
        };
        let doneCount = 0;
        let failCount = 0;
        const failedEpisodes: Array<{ name: string; error: string }> = [];
        try {
          // 逐集下载（每集内部：SDK 静态解析 → 失败回退浏览器解析），并发 2。
          const CONCURRENCY = 2;
          let next = 0;
          async function worker(): Promise<void> {
            while (true) {
              const index = next;
              next += 1;
              const episode = episodes[index];
              if (episode === undefined) return;
              send("episode-start", { index, total: episodes.length, name: episode.name });
              try {
                const filePath = await downloadEpisode({
                  client,
                  rule,
                  episode,
                  title,
                  outputDir: baseDir,
                });
                doneCount += 1;
                // ffprobe 分析分辨率/码率，记录下载历史；回写规则排名（下载成功 + 速率）。
                const probe = await probeFile(filePath);
                void recordRuleDownload(rule, true, probe?.bitrate ?? 0);
                getDownloadManager("kazumi").record({
                  filename: basename(filePath),
                  filePath,
                  status: "done",
                  ...(probe?.resolution !== undefined ? { resolution: probe.resolution } : {}),
                  ...(probe?.bitrate !== undefined ? { bitrate: probe.bitrate } : {}),
                });
                send("episode-done", {
                  index,
                  total: episodes.length,
                  name: episode.name,
                  filePath,
                  ...(probe?.resolution !== undefined ? { resolution: probe.resolution } : {}),
                  ...(probe?.bitrate !== undefined ? { bitrate: probe.bitrate } : {}),
                });
              } catch (error) {
                failCount += 1;
                // 回写规则排名（下载失败）。
                void recordRuleDownload(rule, false, 0);
                const msg = error instanceof Error ? error.message : "下载失败";
                failedEpisodes.push({ name: episode.name, error: msg });
                send("episode-fail", { index, total: episodes.length, name: episode.name, error: msg });
              }
            }
          }
          await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, episodes.length) }, () => worker()),
          );
          send("done", { done: doneCount, failed: failCount, failedEpisodes });
        } catch (error) {
          appLogger.error("kazumi download-all failed", { rule, title, dir: safeSub, error });
          send("error", {
            message: error instanceof Error && error.message !== "" ? error.message : "批量下载失败",
          });
        } finally {
          try {
            controller.close();
          } catch {
            // 已关闭则忽略。
          }
        }
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  })
  /** GET /api/kazumi/stream?url=xxx&rule=xxx —— 解析播放页 → 可播的代理 m3u8 URL。 */
  .get("/stream", async (c) => {
    const url = c.req.query("url");
    const rule = c.req.query("rule");
    if (url === undefined || rule === undefined) return c.json({ error: "参数错误" }, 400);
    const client = createClient();
    try {
      const animeRule = await client.rules.load(rule);
      const resolver = new PlaybackResolver();
      let videoUrl: string | null = null;
      let viaBrowser = false;
      try {
        const resolved = await resolver.resolve(url, headersFor(animeRule), 15_000);
        videoUrl = resolved.url;
      } catch {
        // 静态解析失败（加密源/JS 动态取流）：回退 headless Chromium 浏览器解析，
        // 让页面 JS 跑起来后从网络层/注入脚本截获真实视频地址（对齐 Kazumi 方案）。
        const browserUrl = await resolveWithBrowser(url, { timeoutMs: 25_000 });
        if (browserUrl !== null) {
          videoUrl = browserUrl;
          viaBrowser = true;
        }
      }
      if (videoUrl === null) {
        // 播放解析失败：回写播放成功率（自动降权播放不稳定的源）。
        void recordRulePlay(rule, false);
        return c.json({ error: "无法解析播放地址（加密源且浏览器解析失败）" }, 500);
      }
      // 播放解析成功：回写播放成功率。
      void recordRulePlay(rule, true);
      if (viaBrowser) {
        appLogger.info("kazumi stream via browser", { rule, url: videoUrl.slice(0, 120) });
        // 浏览器拿到的是 mp4 直链（加密源多为腾讯 CDN mp4）：走代理给前端播放（补 referer + Range）。
        if (/\.mp4(\?|$)/i.test(videoUrl)) {
          return c.json({
            m3u8Url: `/api/kazumi/proxy-video?url=${encodeURIComponent(videoUrl)}&rule=${encodeURIComponent(rule)}`,
            direct: true,
          });
        }
      }
      // 读取 m3u8 master playlist 的最高码率变体信息（码率/分辨率），随响应返回供前端展示。
      let bandwidth: number | undefined;
      let resolution: string | undefined;
      try {
        const content = await fetchText(videoUrl, headersFor(animeRule));
        const parsed = parseM3u8(content);
        if (parsed.type === "master" && parsed.variants !== undefined && parsed.variants.length > 0) {
          const best = parsed.variants.reduce((a, b) => (b.bandwidth > a.bandwidth ? b : a));
          bandwidth = best.bandwidth;
          resolution = best.resolution;
        }
      } catch {
        // 读码率失败不影响播放。
      }
      return c.json({
        m3u8Url: `/api/kazumi/playlist?url=${encodeURIComponent(videoUrl)}&rule=${encodeURIComponent(rule)}`,
        ...(bandwidth !== undefined ? { bandwidth } : {}),
        ...(resolution !== undefined ? { resolution } : {}),
      });
    } catch (error) {
      // 透传具体解析失败原因(如该源为 JS 动态取流/加密播放),供前端给出明确提示与手动兜底。
      const message = error instanceof Error ? error.message : "解析播放地址失败";
      return c.json({ error: message }, 500);
    }
  })
  /** GET /api/kazumi/playlist?url=xxx&rule=xxx —— 代理 m3u8（master 选 best → media，重写分片/key URI）。 */
  .get("/playlist", async (c) => {
    const url = c.req.query("url");
    const rule = c.req.query("rule");
    if (url === undefined || rule === undefined) return c.json({ error: "参数错误" }, 400);
    const client = createClient();
    try {
      const animeRule = await client.rules.load(rule);
      const headers = headersFor(animeRule);
      let playlistUrl = url;
      let content = await fetchText(playlistUrl, headers);
      let parsed = parseM3u8(content);
      if (parsed.type === "master" && parsed.variants !== undefined && parsed.variants.length > 0) {
        const best = parsed.variants.reduce((a, b) => (b.bandwidth > a.bandwidth ? b : a));
        playlistUrl = new URL(best.uri, playlistUrl).toString();
        content = await fetchText(playlistUrl, headers);
        parsed = parseM3u8(content);
      }
      const media = parsed.media;
      if (media === undefined) return c.json({ error: "m3u8 解析失败" }, 500);
      const rewritten = rewriteM3u8(media, playlistUrl, rule);
      return new Response(rewritten, {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    } catch {
      return c.json({ error: "播放地址解析失败" }, 500);
    }
  })
  /** GET /api/kazumi/seg?url=xxx&rule=xxx —— 代理 m3u8 分片/key（补 user-agent/referer）。 */
  .get("/seg", async (c) => {
    const url = c.req.query("url");
    const rule = c.req.query("rule");
    if (url === undefined || rule === undefined) return c.json({ error: "参数错误" }, 400);
    const client = createClient();
    try {
      const animeRule = await client.rules.load(rule);
      const resp = await fetch(url, { headers: headersFor(animeRule), redirect: "follow" });
      if (!resp.ok || resp.body === null) return c.json({ error: "代理失败" }, 500);
      const h: Record<string, string> = {
        "content-type": resp.headers.get("content-type") ?? "application/octet-stream",
      };
      const len = resp.headers.get("content-length");
      if (len !== null) h["content-length"] = len;
      return new Response(resp.body, { headers: h });
    } catch {
      return c.json({ error: "代理失败" }, 500);
    }
  })
  /**
   * GET /api/kazumi/proxy-video?url=xxx&rule=xxx —— 代理视频直链（mp4/m3u8），
   * 补 referer/UA + 转发 Range（支持拖动 seek）。供浏览器解析到的加密源直链播放。
   */
  .get("/proxy-video", async (c) => {
    const url = c.req.query("url");
    const rule = c.req.query("rule");
    if (url === undefined || rule === undefined) return c.json({ error: "参数错误" }, 400);
    const range = c.req.header("range");
    const client = createClient();
    try {
      const animeRule = await client.rules.load(rule);
      const resp = await fetch(url, {
        headers: {
          ...headersFor(animeRule),
          ...(range !== undefined && range !== "" ? { range } : {}),
        },
        redirect: "follow",
      });
      if (!resp.ok || resp.body === null) return c.json({ error: "代理失败" }, 500);
      const h: Record<string, string> = {
        "content-type": resp.headers.get("content-type") ?? "application/octet-stream",
        "accept-ranges": "bytes",
      };
      const len = resp.headers.get("content-length");
      if (len !== null) h["content-length"] = len;
      const contentRange = resp.headers.get("content-range");
      if (contentRange !== null) h["content-range"] = contentRange;
      return new Response(resp.body, { status: resp.status, headers: h });
    } catch {
      return c.json({ error: "代理失败" }, 500);
    }
  })
  /** GET /api/kazumi/download-history —— 番剧下载历史（按平台隔离）。 */
  .get("/download-history", (c) => {
    return c.json({ records: getDownloadManager("kazumi").history() });
  })
  /** POST /api/kazumi/download-history/clear —— 清空番剧下载历史。 */
  .post("/download-history/clear", (c) => {
    getDownloadManager("kazumi").clearHistory();
    return c.json({ ok: true });
  })
  /** POST /api/kazumi/download-history/remove —— 删除单条番剧下载历史。 */
  .post("/download-history/remove", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: unknown };
    const id = typeof body.id === "string" ? body.id : undefined;
    if (id === undefined) return c.json({ error: "missing id" }, 400);
    getDownloadManager("kazumi").removeHistory(id);
    return c.json({ ok: true });
  });
