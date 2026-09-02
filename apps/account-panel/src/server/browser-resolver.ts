/**
 * 浏览器取流解析器（HTTP 客户端版）。
 *
 * Chromium 已拆分为独立服务 browser-proxy（apps/browser-proxy）：
 * 本模块只负责把播放页 URL 交给它解析，取回真实 m3u8/mp4 直链。
 * 主服务镜像因此不再携带 chromium/playwright（体积与安全面都更小）。
 *
 * 未配置 BROWSER_SERVICE_URL 时（本地裸跑等）直接返回 null，
 * 调用方（kazumi 加密源兜底）会走原有报错/降级逻辑。
 */
const SERVICE_URL = process.env.BROWSER_SERVICE_URL?.trim() || "";

/** 解析结果缓存：同一集（播放页 URL）解析一次后 30 分钟内直接复用。 */
const resolveCache = new Map<string, { url: string; expiresAt: number }>();
const RESOLVE_CACHE_TTL_MS = 30 * 60 * 1000;

function cacheGet(key: string): string | null {
  const hit = resolveCache.get(key);
  if (hit !== undefined && hit.expiresAt > Date.now()) return hit.url;
  return null;
}
function cacheSet(key: string, url: string): void {
  resolveCache.set(key, { url, expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS });
}

/**
 * 调用 browser-proxy 解析播放页 → 视频直链。
 * @param url 播放页 URL
 * @returns 视频直链；未配置服务/解析失败/超时返回 null（由调用方回退/报错）。
 */
export async function resolveWithBrowser(
  url: string,
  options: { userAgent?: string; referer?: string; timeoutMs?: number } = {},
): Promise<string | null> {
  const { userAgent, referer, timeoutMs = 25_000 } = options;
  if (SERVICE_URL === "") return null;

  // 命中缓存直接返回（重复播放/下载同一集秒回）。
  const cached = cacheGet(url);
  if (cached !== null) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 5_000);
  try {
    const res = await fetch(`${SERVICE_URL}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, userAgent, referer, timeoutMs }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string | null };
    const found = data.url ?? null;
    if (found !== null) cacheSet(url, found);
    return found;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}