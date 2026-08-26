/**
 * 浏览器登录骨架 —— 启动本机 Chrome/Edge(CDP)弹出独立窗口,
 * 用户登录后轮询捕获会话 cookie(含 HttpOnly),可选复用日常浏览器 profile 免输入账号密码;
 * 无可用浏览器时回退"捕获页"(用户从 F12 复制 Cookie 头粘贴回传)。
 *
 * 与 qr-flow.ts / password-flow.ts 平行:平台差异(登录页、cookie 域、会话特征、
 * 登录后校验、凭证序列化)全部收敛在 BrowserLoginAdapter,本文件不感知具体平台。
 * 该形态适合"无公开登录 API、只能靠浏览器会话"的平台(如 BOOTH)。
 *
 * CDP 仅在本机回环通信(127.0.0.1 调试端口 + WebSocket),凭证不经过任何第三方。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AccountError, toAccountError } from "./errors.js";
import { openBrowserDefault } from "./qr-flow.js";
import type { AuthPayload, AuthStore } from "./store.js";
import type { LoginResult, LoginStatus, PlatformCredentials } from "./types.js";

/** 平台浏览器登录适配器(平台包实现)。 */
export interface BrowserLoginAdapter {
  /** 平台名,如 "booth",决定 AuthStore 默认路径。 */
  readonly platform: string;
  /** 登录页 URL(在弹起的 Chrome 窗口中打开)。 */
  readonly loginUrl: string;
  /** 只收集这些域的 cookie(如 ["booth.pm", "pixiv.net"])。 */
  readonly cookieDomains: string[];
  /** 出现任一即视为登录成功的会话 cookie 名。 */
  readonly sessionCookieNames: string[];
  /**
   * 可选:登录后校验 cookie 头是否有效(如请求用户页确认未被重定向到登录页)。
   * 抛 AccountError 表示会话无效,登录失败。
   */
  validate?(cookieHeader: string, fetchImpl: typeof fetch): Promise<void>;
  /** 凭证序列化/反序列化(与 QrLoginAdapter / PasswordLoginAdapter 相同)。 */
  serialize(credentials: PlatformCredentials, savedAt: string): AuthPayload;
  deserialize(payload: AuthPayload): PlatformCredentials | null;
}

/** 浏览器登录选项。 */
export interface BrowserLoginOptions {
  /** 平台适配器(必填)。 */
  adapter: BrowserLoginAdapter;
  /** 登录态存储;不传则不持久化(仅返回凭证)。 */
  store?: AuthStore;
  /** 浏览器可执行文件路径;缺省自动检测本机 Chrome/Edge。 */
  browserPath?: string;
  /**
   * 复用日常浏览器 profile 的登录态(免重新输入账号密码)。
   * 默认 false:用临时 profile(隔离,不碰日常浏览器)。
   * 为 true 时:定位本机 Chrome/Edge 默认 User Data 目录启动,直接使用其中已登录的会话;
   * 若该浏览器正在运行会报错提示先关闭。
   */
  reuseBrowserProfile?: boolean;
  /** 显式指定 profile 目录(覆盖 reuseBrowserProfile 的推断);该目录不会被删除。 */
  profileDir?: string;
  /** 是否使用 CDP 自动浏览器登录;默认 true(检测到 Chrome/Edge 时)。显式 false 走捕获页(测试/无头环境)。 */
  useCdp?: boolean;
  /** 登录页 URL(覆盖 adapter.loginUrl)。 */
  loginUrl?: string;
  /** 等待用户登录的总超时(毫秒),默认 300000(5 分钟)。 */
  timeoutMs?: number;
  /** 登录过程日志回调(CDP 模式)。 */
  onLog?: (message: string) => void;
  /** 自定义浏览器打开器(捕获页用);缺省用平台默认命令。 */
  openBrowser?: (url: string) => void | Promise<void>;
  /** 注入 fetch 实现(测试用)。 */
  fetchImpl?: typeof fetch;
  /** 进度回调。state: waiting | success | timeout | failed。 */
  onStatus?: (status: LoginStatus) => void;
}

/**
 * 执行浏览器登录:CDP 自动捕获(优先)→ 捕获页回退 → 平台校验 → 可选持久化。
 * 返回 { credentials: { cookieHeader }, saved }。
 */
export async function browserLogin(options: BrowserLoginOptions): Promise<LoginResult> {
  const { adapter, store } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const loginUrl = options.loginUrl ?? adapter.loginUrl;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const log = options.onLog ?? ((): void => {});
  const emit = (status: LoginStatus): void => {
    options.onStatus?.(status);
  };

  // 1. 优先 CDP 自动捕获(零复制粘贴);useCdp: false 时跳过(测试/无头环境)。
  const browserPath =
    options.useCdp === false ? undefined : options.browserPath ?? detectBrowser();
  let cookieHeader: string;
  if (browserPath !== undefined) {
    const profileDir =
      options.profileDir ??
      (options.reuseBrowserProfile === true
        ? defaultBrowserProfileDir(browserPath)
        : undefined);
    const result = await cdpCaptureCookies({
      browserPath,
      loginUrl,
      ...(profileDir !== undefined ? { profileDir } : {}),
      cookieDomains: adapter.cookieDomains,
      sessionCookieNames: adapter.sessionCookieNames,
      timeoutMs,
      log,
    });
    cookieHeader = result.cookieHeader;
  } else {
    // 2. 回退:捕获页(用户粘贴 Cookie 头)。
    emit({ state: "waiting", message: "未检测到可用浏览器,走捕获页登录" });
    cookieHeader = await capturePageLogin({
      platform: adapter.platform,
      loginUrl,
      ...(options.openBrowser !== undefined ? { openBrowser: options.openBrowser } : {}),
      timeoutMs,
    });
  }

  // 3. 平台校验登录态(如请求用户页确认非登录页)。
  if (adapter.validate !== undefined) {
    try {
      await adapter.validate(cookieHeader, fetchImpl);
    } catch (error) {
      throw toAccountError(error, "登录态校验失败");
    }
  }

  // 4. 序列化 + 可选持久化。
  emit({ state: "success", message: "登录成功" });
  if (store !== undefined) {
    const payload = adapter.serialize({ cookieHeader }, new Date().toISOString());
    await store.save(payload);
  }
  return { credentials: { cookieHeader }, saved: store !== undefined };
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

// ---- 内部:CDP 自动捕获 ----

interface CdpCaptureOptions {
  browserPath: string;
  loginUrl: string;
  /** undefined = 用临时隔离 profile(用完删除);传入 = 复用该 profile(不删除)。 */
  profileDir?: string;
  cookieDomains: string[];
  sessionCookieNames: string[];
  timeoutMs: number;
  log: (message: string) => void;
}

interface CdpCaptureResult {
  /** 提取到的 cookie 头字符串(如 "a=b; c=d")。 */
  cookieHeader: string;
  port: number;
}

/**
 * CDP(Chrome DevTools Protocol)自动捕获 —— 启动独立 Chrome 窗口捕获会话 cookie。
 * 流程:生成临时 profile + 随机调试端口 → Target.createTarget 打开登录页 →
 * 用户手动登录 → 轮询 Storage.getCookies 直到捕获到会话 cookie(含 HttpOnly) →
 * 提取 cookie 头,关闭 Chrome,清理临时 profile。
 */
async function cdpCaptureCookies(options: CdpCaptureOptions): Promise<CdpCaptureResult> {
  const { browserPath, loginUrl, profileDir, cookieDomains, sessionCookieNames, timeoutMs, log } =
    options;
  const domainRegex = buildDomainRegex(cookieDomains);

  if (!existsSync(browserPath)) {
    throw new AccountError("UNKNOWN", `browser not found: ${browserPath}`);
  }

  // profile:临时(缺省)或复用传入的日常浏览器 profile。
  const isTempProfile = profileDir === undefined;
  const resolvedProfileDir =
    profileDir ?? mkdtempSync(path.join(tmpdir(), "sc-cdp-"));
  const port = 30000 + Math.floor(Math.random() * 20000);

  // 复用日常 profile 时,若该浏览器已在运行,新进程会并入已有实例,
  // 调试端口不生效。这里用"端口是否就绪"兜底检测(锁文件检测不可靠)。
  if (!isTempProfile) {
    const lockFiles = ["SingletonLock", "SingletonSocket", "SingletonCookie"];
    const locked = lockFiles.some((name) => existsSync(path.join(resolvedProfileDir, name)));
    if (locked) {
      throw new AccountError(
        "UNKNOWN",
        "日常浏览器正在运行:请先完全关闭该浏览器(Chrome/Edge),再重试登录以复用其登录态。",
      );
    }
  }

  let child: ChildProcess | null = null;
  let cdp: CdpClient | null = null;

  const cleanup = (): void => {
    try {
      cdp?.close();
    } catch {
      // 忽略关闭错误。
    }
    if (child !== null && child.exitCode === null && !child.killed) {
      try {
        child.kill();
      } catch {
        // 进程可能已退出。
      }
    }
    // 仅临时 profile 延迟删除;复用日常 profile 不清理。
    if (isTempProfile) {
      setTimeout(() => {
        try {
          rmSync(resolvedProfileDir, { recursive: true, force: true });
        } catch {
          // 忽略清理失败。
        }
      }, 2000);
    }
  };

  try {
    log(`启动 Chrome(端口 ${port})...`);
    child = spawn(
      browserPath,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${resolvedProfileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "about:blank",
      ],
      { stdio: "ignore", detached: false },
    );

    // 复用日常 profile:若浏览器已在运行,新进程会很快退出(并入已有实例),
    // 此时端口不会就绪。提前检测退出事件给出明确提示。
    if (!isTempProfile) {
      const exited = new Promise<number | null>((res) => {
        child?.once("exit", (code) => res(code ?? 0));
      });
      const portReady = waitForPort(port, 8000).then(
        () => null,
        () => "timeout",
      );
      const first = await Promise.race([exited, portReady]);
      if (first !== null) {
        // 端口 8 秒内未就绪,且(或)子进程已退出 → 大概率 Chrome 已在运行。
        throw new AccountError(
          "UNKNOWN",
          "未能启动带调试端口的浏览器:请先完全关闭 Chrome/Edge(含系统托盘),再重试 --reuse 登录。",
        );
      }
    }

    // 等调试端口就绪,拿 browser ws 端点。
    try {
      await waitForPort(port, 15000);
    } catch (error) {
      if (!isTempProfile) {
        // 复用日常 profile:端口起不来通常是 Chrome 已在运行并入实例,给出针对性提示。
        throw new AccountError(
          "UNKNOWN",
          "未能启动带调试端口的浏览器:请先完全关闭 Chrome/Edge(含系统托盘),再重试 --reuse 登录。",
        );
      }
      throw error;
    }
    const wsUrl = await fetchBrowserWsUrl(port);
    cdp = await CdpClient.connect(wsUrl);

    // 打开登录页。
    log(`打开登录页 ${loginUrl}`);
    await cdp.send("Target.createTarget", { url: loginUrl });

    // 轮询 cookies 直到出现会话特征。
    log("请在打开的 Chrome 窗口中完成登录…");
    const deadline = Date.now() + timeoutMs;
    let cookieHeader: string | null = null;
    while (Date.now() < deadline) {
      const result = await cdp.send<{ cookies: Array<{ name: string; value: string; domain: string }> }>(
        "Storage.getCookies",
        {},
      );
      const cookies = (result?.cookies ?? []).filter((c) => domainRegex.test(c.domain));
      const sessionCookie = cookies.find((c) => sessionCookieNames.includes(c.name));
      if (sessionCookie !== undefined && cookies.length > 0) {
        // 多等一拍确保会话稳定。
        await delay(800);
        const finalResult = await cdp.send<{ cookies: Array<{ name: string; value: string; domain: string }> }>(
          "Storage.getCookies",
          {},
        );
        const finalCookies = (finalResult?.cookies ?? []).filter((c) => domainRegex.test(c.domain));
        cookieHeader = finalCookies.map((c) => `${c.name}=${c.value}`).join("; ");
        break;
      }
      await delay(1500);
    }

    if (cookieHeader === null) {
      throw new AccountError("AUTH_EXPIRED", "登录超时:未在 Chrome 中完成登录");
    }
    log("已捕获会话 cookie。");
    return { cookieHeader, port };
  } catch (error) {
    if (error instanceof AccountError) {
      throw error;
    }
    throw new AccountError(
      "UNKNOWN",
      error instanceof Error ? `CDP login failed: ${error.message}` : "CDP login failed",
      { cause: error },
    );
  } finally {
    cleanup();
  }
}

/** 简易 CDP JSON-RPC 客户端(浏览器 WebSocket + fetch,零依赖)。 */
class CdpClient {
  readonly #ws: WebSocket;
  #nextId = 1;
  readonly #pending = new Map<number, (resp: CdpResponse) => void>();

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.addEventListener("message", (event) => {
      let parsed: CdpResponse;
      try {
        parsed = JSON.parse(String((event as MessageEvent).data)) as CdpResponse;
      } catch {
        return;
      }
      if (parsed.id === undefined) {
        return;
      }
      const resolver = this.#pending.get(parsed.id);
      if (resolver !== undefined) {
        this.#pending.delete(parsed.id);
        resolver(parsed);
      }
    });
  }

  static async connect(wsUrl: string, timeoutMs = 10000): Promise<CdpClient> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connect timeout")), timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolvePromise();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("CDP connect failed"));
      });
    });
    return new CdpClient(ws);
  }

  /** 发送命令并等待结果。 */
  async send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise<T>((resolvePromise, reject) => {
      this.#pending.set(id, (resp) => {
        if (resp.error !== undefined) {
          reject(new Error(`CDP ${method} failed: ${resp.error.message}`));
          return;
        }
        resolvePromise(resp.result as T);
      });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.#ws.close();
  }
}

interface CdpResponse {
  id: number;
  result?: unknown;
  error?: { message: string };
}

/** 等待 TCP 端口可访问(Chrome 调试端点就绪)。 */
async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // 端口未就绪,继续等。
    }
    if (Date.now() > deadline) {
      throw new AccountError("UNKNOWN", "Chrome debug port did not become ready");
    }
    await delay(200);
  }
}

/** 通过 /json/version 获取 browser WebSocket 端点。 */
async function fetchBrowserWsUrl(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  const payload = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (typeof payload.webSocketDebuggerUrl !== "string") {
    throw new AccountError("UNKNOWN", "cannot get Chrome debug websocket url");
  }
  return payload.webSocketDebuggerUrl;
}

// ---- 内部:捕获页回退 ----

interface CapturePageOptions {
  platform: string;
  loginUrl: string;
  openBrowser?: (url: string) => void | Promise<void>;
  timeoutMs: number;
}

/**
 * 捕获页登录:本地回环 HTTP 页面,引导用户登录后把浏览器里的 Cookie 头粘贴回传。
 * 说明:会话 cookie 只在该平台域有效,本机捕获页跨域读不到,
 * 因此由用户从浏览器 F12 复制 Cookie 头(仅回传本机回环地址,不经过第三方)。
 */
async function capturePageLogin(options: CapturePageOptions): Promise<string> {
  const { platform, loginUrl, timeoutMs } = options;

  // 超时定时器集合(race settle 后统一清理,避免 unhandled rejection)。
  const timers = new Set<ReturnType<typeof setTimeout>>();

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
          const value =
            match?.[1] !== undefined ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
          finish(value);
        });
        return;
      }
      finish(url.searchParams.get("cookies") ?? "");
      return;
    }
    if (url.pathname === "/capture.html") {
      const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${platform} login capture</title></head>
<body>
<h2>${platform} 登录捕获</h2>
<p>1. 请在新标签页登录 ${platform}(<a href="${loginUrl}" target="_blank">打开登录页</a>)。</p>
<p>2. 登录后,按 F12 → Network → 刷新页面 → 点任意 ${platform} 请求 → Request Headers → 复制 <b>Cookie</b> 的值。</p>
<p>3. 把 Cookie 头内容粘贴到下面,点击「保存」。(仅发送到本机 127.0.0.1,不经过第三方。)</p>
<form onsubmit="send(event)">
  <textarea id="c" rows="6" cols="80" placeholder="粘贴 Cookie 头,如 session=...; ..."></textarea>
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
    // 打开捕获页(用户在该页面跳转到平台登录,或在新标签登录后回来点击)。
    const open = options.openBrowser ?? openBrowserDefault;
    await open(captureUrl);
    // 超时用可取消定时器:race 已 settle 后清除,避免残留 promise 触发 unhandled rejection。
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new AccountError("LOGIN_REQUIRED", "捕获页登录超时,请重新执行 login"));
      }, timeoutMs);
      timers.add(timer);
    });
    try {
      await Promise.race([done, timeout]);
    } finally {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
    }
    if (capturedCookies === null) {
      throw new AccountError("UNKNOWN", "no cookies captured");
    }
    return capturedCookies;
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
  }
}

// ---- 工具 ----

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function pathJoin(...parts: string[]): string {
  return parts.join("\\").replace(/\\+/g, "\\");
}

/** 从 cookie 域列表构建匹配正则(如 ["booth.pm"] → /(^|\.)(booth\.pm)$/)。 */
function buildDomainRegex(domains: string[]): RegExp {
  const escaped = domains.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(^|\\.)(${escaped.join("|")})$`);
}
