/**
 * browser-proxy：headless Chromium 取流解析独立服务。
 *
 * 从 account-panel 拆分出来的浏览器兜底能力（kazumi 加密源/JS 动态取流）：
 * 用系统 Chromium 打开播放页，注入脚本拦截 fetch/XHR 与 DOM video，截获真实 m3u8/mp4 地址。
 * account-panel 等消费方通过 POST /resolve 调用，自身镜像不再携带 chromium/playwright。
 *
 * 端点：
 *   GET  /health          -> { ok: true }
 *   POST /resolve         -> { url: string|null }   body: { url, userAgent?, referer?, timeoutMs? }
 */
import http from "node:http";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT ?? 9222);
const SYSTEM_CHROMIUM = "/usr/bin/chromium-browser";

/** 惰性单例浏览器（复用进程，避免每次解析都启动）。 */
let browserPromise = null;
function getBrowser() {
  browserPromise ??= chromium.launch({
    headless: true,
    executablePath: SYSTEM_CHROMIUM,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  return browserPromise;
}

/** 解析结果缓存：同一集 30 分钟内直接复用。 */
const resolveCache = new Map();
const RESOLVE_CACHE_TTL_MS = 30 * 60 * 1000;
function cacheGet(key) {
  const hit = resolveCache.get(key);
  if (hit !== undefined && hit.expiresAt > Date.now()) return hit.url;
  return null;
}
function cacheSet(key, url) {
  resolveCache.set(key, { url, expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS });
}

/** 注入页面的拦截脚本（与 Kazumi 相同思路：篡改 Response/XHR 拦截视频响应）。 */
const SNIFF_SCRIPT = `
  window.__kazumiVideo = null;
  function isVideoText(t) { return typeof t === 'string' && (t.trim().startsWith('#EXTM3U') || t.trim().startsWith('ID3')); }
  function isVideoUrl(u) {
    if (!u) return false;
    return /\.(m3u8|mp4|m4s|flv)(\\?|$)/i.test(u) || /groupvideo|\.mp4/i.test(u);
  }
  function report(url) {
    if (url && isVideoUrl(url) && !window.__kazumiVideo) {
      window.__kazumiVideo = url;
      try { window.__kazumiBridge && window.__kazumiBridge(url); } catch (e) {}
    }
  }
  const _r_text = window.Response.prototype.text;
  window.Response.prototype.text = function () {
    return new Promise((resolve, reject) => {
      _r_text.call(this).then((text) => {
        resolve(text);
        if (isVideoText(text)) report(this.url);
      }).catch(reject);
    });
  };
  const _open = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function (...args) {
    this.addEventListener('load', () => {
      try {
        const content = this.responseText;
        if (isVideoText(content)) report(args[1]);
      } catch (e) {}
    });
    return _open.apply(this, args);
  };
  function processVideo(video) {
    let src = video.getAttribute('src');
    if (src && isVideoUrl(src) && !src.startsWith('blob:') && !src.includes('googleads')) { report(src); return true; }
    const sources = video.getElementsByTagName('source');
    for (let s of sources) {
      src = s.getAttribute('src');
      if (src && isVideoUrl(src) && !src.startsWith('blob:') && !src.includes('googleads')) { report(src); return true; }
    }
    return false;
  }
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes' && m.target.nodeName === 'VIDEO') { if (processVideo(m.target)) return; continue; }
      for (const n of m.addedNodes) {
        if (n.nodeName === 'VIDEO') { if (processVideo(n)) return; }
        if (n.querySelectorAll) { for (const v of n.querySelectorAll('video')) { if (processVideo(v)) return; } }
      }
    }
  });
  function setup() {
    for (const v of document.querySelectorAll('video')) { if (processVideo(v)) return; }
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
`;

/** 打开播放页解析 → m3u8/mp4 直链；失败返回 null。 */
async function resolveWithBrowser(url, { userAgent, timeoutMs = 25_000 } = {}) {
  const cached = cacheGet(url);
  if (cached !== null) return cached;
  let browser;
  try {
    browser = await getBrowser();
  } catch {
    return null;
  }
  const context = await browser.newContext({
    userAgent: userAgent ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  try {
    let found = null;
    await page.exposeFunction("__kazumiBridge", (u) => { if (!found) found = u; });
    await page.addInitScript(SNIFF_SCRIPT);
    const grab = (u) => {
      if (/\.(m3u8|mp4|m4s|flv)(\?|$)/i.test(u) || u.includes("groupvideo")) {
        if (!found) found = u;
        return true;
      }
      return false;
    };
    page.on("request", (req) => { if (!found) grab(req.url()); });
    page.on("response", (res) => { if (!found) grab(res.url()); });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 20_000) }).catch(() => {});
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && found === null) {
      await page.waitForTimeout(150);
      if (found) break;
      const sniffed = await page.evaluate(() => window.__kazumiVideo ?? null).catch(() => null);
      if (sniffed) { found = sniffed; break; }
    }
    if (found !== null) cacheSet(url, found);
    return found;
  } catch {
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}

async function handleResolve(req, res) {
  let body = "";
  for await (const chunk of req) body += chunk;
  let input;
  try {
    input = JSON.parse(body || "{}");
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid json" }));
    return;
  }
  const { url, userAgent, referer, timeoutMs } = input ?? {};
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "url required" }));
    return;
  }
  const result = await resolveWithBrowser(url, { userAgent, referer, timeoutMs });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ url: result }));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (u.pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (u.pathname === "/resolve" && req.method === "POST") {
    void handleResolve(req, res);
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`[browser-proxy] listening on http://127.0.0.1:${PORT}`);
});

process.on("SIGTERM", async () => {
  try {
    if (browserPromise !== null) {
      const b = await browserPromise;
      await b.close().catch(() => {});
    }
  } finally {
    process.exit(0);
  }
});