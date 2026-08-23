/**
 * BoothClient —— BOOTH SDK 统一入口。
 * 登录态:显式 cookie 优先,否则从 account AuthStore 自动加载。
 * 合规:付费商品只生成待支付订单,支付留在浏览器;批量默认并发 1。
 */
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { BoothError, toBoothError } from "./errors.js";
import { cdpLogin } from "./cdp.js";
import type {
  BoothClientOptions,
  BoothItem,
  BoothItemDetail,
  BoothLoginOptions,
  ClaimAndDownloadResult,
  ClaimResult,
} from "./types.js";
import { BoothSession } from "./session.js";
import { ItemApi } from "./api/item.js";
import { ClaimApi, toClaimResult } from "./api/order.js";
import { DownloadApi } from "./api/download.js";
import { parseBoothInput } from "./parsers/url.js";

/** BOOTH 客户端。 */
export class BoothClient {
  readonly #session: BoothSession;
  readonly #items: ItemApi;
  readonly #claims: ClaimApi;
  readonly #downloads: DownloadApi;
  readonly #claimConcurrency: number;
  readonly #authPath: string | undefined;
  readonly #downloadConfig: NonNullable<BoothClientOptions["download"]>;

  constructor(options: BoothClientOptions = {}) {
    this.#authPath = options.authPath;
    this.#session = new BoothSession({
      ...(options.cookie !== undefined ? { cookie: options.cookie } : {}),
      ...(options.authPath !== undefined ? { authPath: options.authPath } : {}),
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    });
    this.#items = new ItemApi(this.#session);
    this.#claims = new ClaimApi(this.#session);
    this.#downloads = new DownloadApi(this.#session);
    this.#claimConcurrency = options.claim?.concurrency ?? 1;
    this.#downloadConfig = {
      ...(options.download?.retries !== undefined ? { retries: options.download.retries } : {}),
      ...(options.download?.rateLimitBps !== undefined ? { rateLimitBps: options.download.rateLimitBps } : {}),
      ...(options.download?.skipExisting !== undefined ? { skipExisting: options.download.skipExisting } : {}),
    };
  }

  /** 当前是否已登录(有会话 cookie)。 */
  get isLoggedIn(): boolean {
    return this.#session.isLoggedIn;
  }

  /** 登录态存储路径(未配置 authPath 时为 undefined)。 */
  get authPath(): string | undefined {
    return this.#authPath;
  }

  /** 解析输入:booth.pm 链接或纯数字 ID → 商品信息。 */
  async getItem(input: string): Promise<BoothItem> {
    const { itemId } = parseBoothInput(input);
    return this.#items.getItem(itemId);
  }

  /**
   * 解析商品详情(简介/正文 + 全部购买项),字段按需获取省 token。
   * getItem 的精简版不含 description/variations;需要详情时用这个方法。
   */
  async getItemDetail(
    input: string,
    options?: { description?: boolean; variations?: boolean },
  ): Promise<BoothItemDetail> {
    const { itemId } = parseBoothInput(input);
    return this.#items.getItemDetail(itemId, {
      ...(options?.description !== undefined ? { description: options.description } : {}),
      ...(options?.variations !== undefined ? { variations: options.variations } : {}),
    });
  }

  /**
   * 批量领取。输入可以是链接或纯 ID;保持输入顺序返回结果。
   * 免费直接领取(downloadUrl);付费加入购物车(payUrl,浏览器手动支付);已拥有跳过。
   * 单项失败不中断,失败项记入结果。
   */
  async claim(inputs: string[], options?: { concurrency?: number }): Promise<ClaimResult[]> {
    if (inputs.length === 0) {
      return [];
    }
    const concurrency = Math.max(1, options?.concurrency ?? this.#claimConcurrency);
    const results: ClaimResult[] = new Array(inputs.length);
    let next = 0;
    const workers: Promise<void>[] = [];
    const runWorker = async (): Promise<void> => {
      for (;;) {
        const index = next;
        if (index >= inputs.length) {
          return;
        }
        next += 1;
        const input = inputs[index];
        if (input === undefined) {
          return;
        }
        results[index] = await this.#claimOne(input);
      }
    };
    for (let i = 0; i < Math.min(concurrency, inputs.length); i += 1) {
      workers.push(runWorker());
    }
    await Promise.all(workers);
    return results;
  }

  /** 便捷:单个输入领取。 */
  async claimByInput(input: string): Promise<ClaimResult> {
    const results = await this.claim([input]);
    const result = results[0];
    if (result === undefined) {
      throw new BoothError("UNKNOWN", "claim produced no result");
    }
    return result;
  }

  /** 下载单个下载直链到 outputDir。返回绝对路径。 */
  async downloadUrl(url: string, options?: { outputDir?: string }): Promise<string> {
    return this.#downloads.downloadUrl(url, {
      ...this.#downloadConfig,
      ...(options?.outputDir !== undefined ? { outputDir: options.outputDir } : {}),
    });
  }

  /**
   * 一条龙:领取后直接下载。
   * 免费 → 领取 + 下载(downloadUrl);付费 → 返回 payUrl 不下载;已拥有/失败 → 不下载。
   */
  async claimAndDownload(
    input: string,
    options?: { outputDir?: string; skipIfPaidPending?: boolean },
  ): Promise<ClaimAndDownloadResult> {
    const claim = await this.claimByInput(input);
    if (claim.status === "paid-pending" && options?.skipIfPaidPending !== false) {
      return { claim, files: [] };
    }
    if (claim.status === "failed" || claim.status === "skipped") {
      return { claim, files: [] };
    }
    if (claim.downloadUrl === undefined) {
      return { claim, files: [] };
    }
    const files = [
      await this.#downloads.downloadUrl(claim.downloadUrl, {
        ...this.#downloadConfig,
        ...(options?.outputDir !== undefined ? { outputDir: options.outputDir } : {}),
      }),
    ];
    return { claim, files };
  }

  /** 保存当前登录态到 AuthStore。 */
  async persistLogin(authPath?: string): Promise<void> {
    await this.#session.persist(authPath);
  }

  /** 清除本地登录态。 */
  async clearLogin(authPath?: string): Promise<void> {
    await this.#session.clear(authPath);
  }

  async #claimOne(input: string): Promise<ClaimResult> {
    try {
      const { itemId } = parseBoothInput(input);
      const item = await this.#items.getItem(itemId);
      const result = await this.#claims.claim(item);
      return toClaimResult(input, itemId, result);
    } catch (error) {
      const boothError = toBoothError(error, { input });
      return {
        input,
        itemId: safeItemId(input),
        status: "failed",
        error: { code: boothError.code, message: boothError.message },
      };
    }
  }
}

/** 从输入尽量提取 itemId(失败时为原输入,仅用于失败结果展示)。 */
function safeItemId(input: string): string {
  try {
    return parseBoothInput(input).itemId;
  } catch {
    return input;
  }
}

/**
 * 浏览器登录:自动检测本机 Chrome/Edge,用 CDP 弹出独立窗口捕获会话 cookie;
 * 无可用浏览器时回退到捕获页(粘贴 Cookie 头)。
 * reuseBrowserProfile: true 时复用日常浏览器 profile 的登录态(免重新输账号密码);
 * 缺省用临时 profile(隔离,不碰日常浏览器)。
 * 返回 { account, saved }。
 */
export async function loginBooth(options: BoothLoginOptions = {}): Promise<{ account: string; saved: boolean }> {
  const loginUrl = options.loginUrl ?? "https://booth.pm/users/sign_in";

  // 1. 优先 CDP 自动捕获(零复制粘贴);useCdp: false 时跳过(测试/无头)。
  const browserPath = options.useCdp === false ? undefined : detectBrowser();
  if (browserPath !== undefined) {
    // 复用日常浏览器 profile(登录态直接可用);找不到 profile 时回退临时 profile。
    const profileDir = options.reuseBrowserProfile === true ? defaultBrowserProfileDir(browserPath) : undefined;
    const result = await cdpLogin({
      browserPath,
      loginUrl,
      ...(profileDir !== undefined ? { profileDir } : {}),
      ...(options.onLog !== undefined ? { onLog: options.onLog } : {}),
    });
    const refreshed = new BoothSession({
      cookie: result.cookieHeader,
      ...(options.authPath !== undefined ? { authPath: options.authPath } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    });
    // 校验会话。
    await validateSession(refreshed);
    await refreshed.persist(options.authPath);
    return { account: "booth-user", saved: true };
  }

  // 2. 回退:捕获页(用户粘贴 Cookie 头)。
  return loginBoothWithCapturePage(options, loginUrl);
}

/** 校验会话:请求用户订单页(accounts.booth.pm/orders),确认非登录页。 */
async function validateSession(refreshed: BoothSession): Promise<void> {
  const check = await refreshed.request("https://accounts.booth.pm/orders", { method: "GET" });
  if (check.status === 200) {
    const html = await check.text();
    if (/login/i.test(html.slice(0, 500))) {
      throw new BoothError("AUTH_EXPIRED", "captured session is not valid (redirected to login)");
    }
  } else if (check.status !== 200) {
    throw new BoothError("AUTH_EXPIRED", `session validation failed with HTTP ${check.status}`);
  }
}

/** 回退登录:捕获页(用户从 F12 复制 Cookie 头粘贴回传)。 */
async function loginBoothWithCapturePage(
  options: BoothLoginOptions,
  loginUrl: string,
): Promise<{ account: string; saved: boolean }> {

  // 生成一次性 token 防 CSRF(本地回环)。
  const token = randomBytes(16).toString("hex");

  // 捕获结果。
  let capturedCookies: string | null = null;
  let resolveDone: (() => void) | null = null;
  const done = new Promise<void>((res) => {
    resolveDone = res;
  });

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/done" && url.searchParams.get("token") === token) {
      // 支持 GET(query)与 POST(form)两种回传。
      const finish = (cookies: string): void => {
        capturedCookies = cookies;
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("OK, you can close this tab and return to the CLI.");
        resolveDone?.();
      };
      if (req.method === "POST") {
        let bodyText = "";
        req.on("data", (chunk: Buffer) => {
          bodyText += chunk.toString("utf-8");
        });
        req.on("end", () => {
          const match = /cookies=([\s\S]*)$/.exec(bodyText);
          const value = match?.[1] !== undefined ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
          finish(value);
        });
        return;
      }
      finish(url.searchParams.get("cookies") ?? "");
      return;
    }
    if (url.pathname === "/capture.html") {
      // 捕获页:引导用户登录 BOOTH 后,把浏览器里的 Cookie 头粘贴到输入框回传。
      // 说明:booth.pm 的会话 cookie 只在该域有效,本机捕获页跨域读不到,
      // 因此由用户从浏览器 F12 复制 Cookie 头(仅回传本机回环地址,不经过第三方)。
      const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>BOOTH login capture</title></head>
<body>
<h2>BOOTH 登录捕获</h2>
<p>1. 请在新标签页登录 BOOTH(Pixiv 账号)。</p>
<p>2. 登录后,按 F12 → Network → 刷新页面 → 点任意 booth.pm 请求 → Request Headers → 复制 <b>Cookie</b> 的值。</p>
<p>3. 把 Cookie 头内容粘贴到下面,点击「保存」。(仅发送到本机 127.0.0.1,不经过第三方。)</p>
<form onsubmit="send(event)">
  <textarea id="c" rows="6" cols="80" placeholder="粘贴 Cookie 头,如 _pixiv_session=...; ..."></textarea>
  <br><button type="submit">保存</button>
</form>
<script>
async function send(event) {
  event.preventDefault();
  const cookies = document.getElementById('c').value.trim();
  if (cookies === '') { alert('请先粘贴 Cookie'); return; }
  const body = new URLSearchParams({ token: '${token}', cookies }).toString();
  const res = await fetch('/done', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  document.body.innerHTML = '<h2>' + await res.text() + '</h2>';
}
</script>
</body></html>`;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  const listen = new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", res);
  });
  await listen;
  const address = server.address();
  const port = address !== null && typeof address === "object" ? address.port : 0;
  const captureUrl = `http://127.0.0.1:${port}/capture.html`;

  try {
    // 打开捕获页(用户在该页面跳转到 BOOTH 登录,或在新标签登录后回来点击)。
    const open = options.openBrowser ?? openBrowserDefault;
    await open(captureUrl);
    void loginUrl; // 引导文案里提示用户去登录
    await done;
    if (capturedCookies === null) {
      throw new BoothError("UNKNOWN", "no cookies captured");
    }

    // 用捕获的 cookie 重建会话并校验登录态。
    const refreshed = new BoothSession({
      cookie: capturedCookies,
      ...(options.authPath !== undefined ? { authPath: options.authPath } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    });
    const check = await refreshed.request("https://accounts.booth.pm/orders", { method: "GET" });
    if (check.status === 200) {
      const html = await check.text();
      if (/login/i.test(html.slice(0, 500))) {
        throw new BoothError("AUTH_EXPIRED", "captured session is not valid (redirected to login)");
      }
    } else if (check.status !== 200) {
      throw new BoothError("AUTH_EXPIRED", `session validation failed with HTTP ${check.status}`);
    }

    // 持久化。
    await refreshed.persist(options.authPath);
    return { account: "booth-user", saved: true };
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
  }
}

/** 默认浏览器打开器(平台相关)。 */
export async function openBrowserDefault(url: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const platform = process.platform;
  const command =
    platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(command, args, { stdio: "ignore", detached: true }).unref();
}

/** 检测本机 Chrome/Edge 可执行文件(常见路径)。 */
export function detectBrowser(): string | undefined {
  const candidates: string[] = [];
  const env = process.env;
  const home = env.USERPROFILE ?? env.HOME ?? "";
  if (env.PROGRAMFILES !== undefined) {
    candidates.push(
      pathJoin(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
      pathJoin(env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
    );
  }
  if (env["PROGRAMFILES(X86)"] !== undefined) {
    candidates.push(
      pathJoin(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
      pathJoin(env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    );
  }
  if (home !== "") {
    candidates.push(
      pathJoin(home, "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
      pathJoin(home, "AppData", "Local", "Microsoft", "Edge", "Application", "msedge.exe"),
    );
    candidates.push(pathJoin(home, ".cache", "ms-playwright", "chromium", "chrome-linux", "chrome"));
  }
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  }
  for (const candidate of candidates) {
    if (candidate !== "" && existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function pathJoin(...parts: string[]): string {
  return parts.join("\\").replace(/\\+/g, "\\");
}

/**
 * 根据浏览器可执行文件推断其日常 profile 目录。
 * Chrome: %LOCALAPPDATA%/Google/Chrome/User Data;Edge 同理。
 * 找不到时回退 undefined(调用方退回临时 profile)。
 */
export function defaultBrowserProfileDir(browserPath: string): string | undefined {
  const lower = browserPath.toLowerCase();
  const isEdge = lower.includes("msedge");
  const isChrome = lower.includes("chrome") && !isEdge;
  const appData = process.env.LOCALAPPDATA;
  if (appData === undefined || appData === "") {
    return undefined;
  }
  const brand = isEdge ? "Microsoft" : isChrome ? "Google" : undefined;
  if (brand === undefined) {
    return undefined;
  }
  const product = isEdge ? "Edge" : "Chrome";
  return pathJoin(appData, brand, product, "User Data");
}

/** 创建客户端。 */
export function createBoothClient(options?: BoothClientOptions): BoothClient {
  return new BoothClient(options);
}
