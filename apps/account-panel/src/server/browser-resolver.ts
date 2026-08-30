/**
 * 浏览器取流解析器（Playwright headless Chromium）。
 *
 * 原理（对齐 Kazumi 客户端的 WebView 方案）：
 * 用 headless Chromium 真正打开播放页，让页面 JS 跑起来，
 * 再通过注入脚本拦截 fetch/XHR 响应与 DOM 中的 video/iframe，
 * 截获页面动态生成的 m3u8 真实地址 —— 覆盖纯静态解析无法处理的加密源。
 */
import { chromium, type Browser, type Page } from "playwright";

let browserPromise: Promise<Browser> | null = null;

/** 惰性单例浏览器（复用进程，避免每次解析都启动）。 */
async function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({
    headless: true,
    // 生产（Docker）用系统 chromium（apk 安装），本地开发用 playwright 自带浏览器。
    ...(process.env.USE_SYSTEM_CHROMIUM === "1"
      ? { executablePath: "/usr/bin/chromium-browser" }
      : {}),
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  return browserPromise;
}

/** 注入页面的拦截脚本（与 Kazumi 相同的思路：篡改 Response/XHR 拦截视频响应）。 */
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
  // 拦截 fetch 响应（m3u8 文本响应 / 视频 URL 响应）
  const _r_text = window.Response.prototype.text;
  window.Response.prototype.text = function () {
    return new Promise((resolve, reject) => {
      _r_text.call(this).then((text) => {
        resolve(text);
        if (isVideoText(text)) report(this.url);
      }).catch(reject);
    });
  };
  // 拦截 XHR 响应
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
  // 监听 video / source 元素（src 直接是 mp4/m3u8）
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

/**
 * 解析播放页 → m3u8 直链。
 * @param url 播放页 URL
 * @param userAgent 请求 UA（规则自带，绕过防盗链）
 * @param referer 请求 Referer
 * @param timeoutMs 超时（默认 20s）
 * @returns m3u8 直链；解析失败返回 null（由调用方回退/报错）
 */
export async function resolveWithBrowser(
  url: string,
  options: { userAgent?: string; referer?: string; timeoutMs?: number } = {},
): Promise<string | null> {
  const { userAgent, timeoutMs = 25_000 } = options;
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: userAgent ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  try {
    // 收集两种信号：注入脚本上报 / 网络层视频请求。
    let found: string | null = null;
    await page.exposeFunction("__kazumiBridge", (u: string) => { if (!found) found = u; });
    await page.addInitScript(SNIFF_SCRIPT);
    const grab = (u: string): boolean => {
      if (/\.(m3u8|mp4|m4s|flv)(\?|$)/i.test(u) || u.includes("groupvideo")) {
        if (!found) found = u;
        return true;
      }
      return false;
    };
    page.on("request", (req) => { if (!found) grab(req.url()); });
    page.on("response", (res) => { if (!found) grab(res.url()); });

    // 打开播放页让 JS 取流；goto 失败不阻断（页面可能仍发起视频请求）。
    await page.goto(url, { waitUntil: "load", timeout: Math.min(timeoutMs, 35_000) }).catch(() => {});
    // 等待信号出现（网络层 + 注入变量双通道轮询）。
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && found === null) {
      await page.waitForTimeout(400);
      if (found) break;
      const sniffed = await page.evaluate(() => (window as unknown as { __kazumiVideo?: string }).__kazumiVideo ?? null).catch(() => null);
      if (sniffed) { found = sniffed; break; }
      // 网络层捕获的可能是 blob 或相对 URL，尽量收绝对地址。
    }
    return found;
  } catch {
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}

/** 释放浏览器进程（应用退出时调用）。 */
export async function closeBrowserResolver(): Promise<void> {
  if (browserPromise !== null) {
    const b = await browserPromise;
    await b.close().catch(() => {});
    browserPromise = null;
  }
}
