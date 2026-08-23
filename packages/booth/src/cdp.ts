/**
 * CDP(Chrome DevTools Protocol)自动登录 —— 启动独立 Chrome 窗口捕获 BOOTH 会话 cookie。
 *
 * 流程:
 *   1. 生成临时 profile + 随机调试端口,启动本机 Chrome(独立实例,不碰用户主 profile);
 *   2. 通过 http://127.0.0.1:<port>/json/version 拿到 WebSocket 调试端点;
 *   3. 用 Target.createTarget 打开 BOOTH 登录页(accounts.booth.pm/login);
 *   4. 用户在弹出的 Chrome 窗口手动登录;
 *   5. 轮询 Storage.getCookies,直到捕获到 booth.pm 域会话 cookie(含 HttpOnly);
 *   6. 提取 cookie 头字符串,关闭 Chrome,清理临时 profile。
 *
 * 仅在本机回环通信,凭证不经过任何第三方。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BoothError } from "./errors.js";

export interface CdpLoginOptions {
  /** Chrome/Edge 可执行文件路径。 */
  browserPath: string;
  /** 登录页 URL。 */
  loginUrl?: string;
  /** 等待用户登录的超时(毫秒),默认 5 分钟。 */
  timeoutMs?: number;
  /** 完成条件:拿到包含这些 cookie 名的任一即视为登录成功(默认 booth 会话特征)。 */
  sessionCookieNames?: string[];
  /**
   * 用户 profile 目录。缺省:临时 profile(隔离,不碰日常浏览器,用完删除)。
   * 传入日常浏览器 profile(如 Chrome 默认 User Data 目录)时,复用其中的登录态,
   * 无需重新输入账号密码;该 profile 不会被删除。
   */
  profileDir?: string;
  /** 日志回调(调试用)。 */
  onLog?: (message: string) => void;
}

export interface CdpLoginResult {
  /** 提取到的 cookie 头字符串(如 "a=b; c=d")。 */
  cookieHeader: string;
  /** 调试端口。 */
  port: number;
}

interface CdpResponse {
  id: number;
  result?: unknown;
  error?: { message: string };
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
      throw new BoothError("UNKNOWN", "Chrome debug port did not become ready");
    }
    await delay(200);
  }
}

/** 通过 /json/version 获取 browser WebSocket 端点。 */
async function fetchBrowserWsUrl(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  const payload = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (typeof payload.webSocketDebuggerUrl !== "string") {
    throw new BoothError("UNKNOWN", "cannot get Chrome debug websocket url");
  }
  return payload.webSocketDebuggerUrl;
}

/** 启动 CDP 自动登录。返回 cookie 头字符串。 */
export async function cdpLogin(options: CdpLoginOptions): Promise<CdpLoginResult> {
  const loginUrl = options.loginUrl ?? "https://booth.pm/users/sign_in";
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const sessionNames = options.sessionCookieNames ?? ["_pixiv_session", "pixiv_session", "__csrf_token"];
  const log = options.onLog ?? ((): void => {});

  if (!existsSync(options.browserPath)) {
    throw new BoothError("UNKNOWN", `browser not found: ${options.browserPath}`);
  }

  // profile:临时(缺省)或复用传入的日常浏览器 profile。
  const isTempProfile = options.profileDir === undefined;
  const profileDir = options.profileDir ?? mkdtempSync(path.join(tmpdir(), "booth-cdp-"));
  const port = 30000 + Math.floor(Math.random() * 20000);

  // 复用日常 profile 时,若该浏览器已在运行,新进程会并入已有实例,
  // 调试端口不生效。这里用"端口是否就绪"兜底检测(锁文件检测不可靠)。
  if (!isTempProfile) {
    const lockFiles = ["SingletonLock", "SingletonSocket", "SingletonCookie"];
    const locked = lockFiles.some((name) => existsSync(path.join(profileDir, name)));
    if (locked) {
      throw new BoothError(
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
          rmSync(profileDir, { recursive: true, force: true });
        } catch {
          // 忽略清理失败。
        }
      }, 2000);
    }
  };

  try {
    log(`启动 Chrome(端口 ${port})...`);
    child = spawn(
      options.browserPath,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
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
        throw new BoothError(
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
        throw new BoothError(
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
    log("请在打开的 Chrome 窗口中登录 BOOTH(Pixiv 账号)…");
    const deadline = Date.now() + timeoutMs;
    let cookieHeader: string | null = null;
    while (Date.now() < deadline) {
      const result = await cdp.send<{ cookies: Array<{ name: string; value: string; domain: string }> }>(
        "Storage.getCookies",
        {},
      );
      const cookies = (result?.cookies ?? []).filter((c) =>
        /(^|\.)booth\.pm$|(^|\.)pixiv\.net$/.test(c.domain),
      );
      const sessionCookie = cookies.find((c) => sessionNames.includes(c.name));
      if (sessionCookie !== undefined && cookies.length > 0) {
        // 多等一拍确保会话稳定。
        await delay(800);
        const finalResult = await cdp.send<{ cookies: Array<{ name: string; value: string; domain: string }> }>(
          "Storage.getCookies",
          {},
        );
        const finalCookies = (finalResult?.cookies ?? []).filter((c) =>
          /(^|\.)booth\.pm$|(^|\.)pixiv\.net$/.test(c.domain),
        );
        cookieHeader = finalCookies.map((c) => `${c.name}=${c.value}`).join("; ");
        break;
      }
      await delay(1500);
    }

    if (cookieHeader === null) {
      throw new BoothError("AUTH_EXPIRED", "登录超时:未在 Chrome 中完成 BOOTH 登录");
    }
    log("已捕获会话 cookie。");
    return { cookieHeader, port };
  } catch (error) {
    if (error instanceof BoothError) {
      throw error;
    }
    throw new BoothError(
      "UNKNOWN",
      error instanceof Error ? `CDP login failed: ${error.message}` : "CDP login failed",
    );
  } finally {
    cleanup();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
