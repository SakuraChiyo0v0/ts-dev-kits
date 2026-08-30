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
import { basename, join } from "node:path";
import { getDownloadManager, downloadRoot } from "../downloads.js";
import { appLogger } from "../logger.js";

/** 番剧规则目录（NAS 持久化）。 */
function rulesDir(): string {
  return join(downloadRoot(), "kazumi", "rules");
}

/** 构造番剧客户端（规则存 NAS）。 */
function createClient(): AnimeClient {
  return createAnimeClient({ rulesDir: rulesDir(), sync: false });
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
          await client.searchStream(q.trim(), {
            signal,
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
      return c.json({
        roads: roads.map((r) => ({ name: r.name, data: r.data, identifier: r.identifier })),
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
    };
    const rule = typeof body.rule === "string" ? body.rule : "";
    const name = typeof body.name === "string" ? body.name : "";
    const url = typeof body.url === "string" ? body.url : "";
    if (rule === "" || url === "") return c.json({ error: "参数错误" }, 400);
    const safeSub = safeSubdir(typeof body.path === "string" ? body.path.trim() : "");

    const client = createClient();
    try {
      const outputDir = safeSub === "" ? downloadRoot() : `${downloadRoot()}/${safeSub}`;
      const { filePath } = await client.download(
        { name, url },
        { outputDir, rule, adFilter: true },
      );
      getDownloadManager("kazumi").record({ filename: basename(filePath), filePath, status: "done" });
      appLogger.info("kazumi download ok", { rule, name, dir: safeSub, filePath });
      return c.json({ filePath });
    } catch (error) {
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
    try {
      const files = await client.downloadAll(episodes, {
        outputDir: baseDir,
        rule,
        title,
        adFilter: true,
        concurrency: 2,
      });
      for (const { filePath } of files) {
        getDownloadManager("kazumi").record({ filename: basename(filePath), filePath, status: "done" });
      }
      appLogger.info("kazumi download-all ok", { rule, title, count: files.length, dir: safeSub });
      return c.json({ done: files.length, failed: episodes.length - files.length, files: files.map((f) => f.filePath) });
    } catch (error) {
      appLogger.error("kazumi download-all failed", { rule, title, dir: safeSub, error });
      const message =
        error instanceof Error && error.message !== "" ? error.message : "批量下载失败";
      return c.json({ error: message }, 500);
    }
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
      const resolved = await resolver.resolve(url, headersFor(animeRule), 30_000);
      return c.json({
        m3u8Url: `/api/kazumi/playlist?url=${encodeURIComponent(resolved.url)}&rule=${encodeURIComponent(rule)}`,
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
