/**
 * 扫码登录 —— 生成二维码、弹出本地窗口(系统浏览器 + 本地页面)、
 * 轮询确认后自动收集 Set-Cookie 与 refresh_token。
 *
 * 流程:qrcode/generate → 本地 HTTP 页面展示二维码 → 手机 App 扫码确认
 *       → 轮询 qrcode/poll → code=0 时收集响应 Set-Cookie + refresh_token。
 */
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { BilibiliAuthError } from "./errors.js";

const GENERATE_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const POLL_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 登录进度状态。 */
export type LoginState = "waiting" | "scanned" | "success" | "expired" | "timeout" | "failed";

export interface LoginStatus {
  state: LoginState;
  message: string;
}

export interface LoginResult {
  /** 完整 cookie 字符串(SESSDATA/bili_jct/DedeUserID 等)。 */
  cookies: string;
  /** 续期用 refresh_token。 */
  refreshToken: string;
}

export interface LoginOptions {
  /** 轮询间隔(毫秒),默认 2000。 */
  pollIntervalMs?: number;
  /** 总超时(毫秒),默认 180000(3 分钟)。 */
  timeoutMs?: number;
  /** 二维码过期后重新生成的最大次数,默认 3。 */
  maxRegenerates?: number;
  /** 自定义浏览器打开器(便于测试);缺省用平台默认命令。 */
  openBrowser?: (url: string) => void | Promise<void>;
  /** 是否自动打开浏览器,默认 true(--no-browser 时 false)。 */
  autoOpenBrowser?: boolean;
  /** 注入 fetch 实现(测试用)。 */
  fetchImpl?: typeof fetch;
  /** 进度回调(测试/UI 用)。 */
  onStatus?: (status: LoginStatus) => void;
}

interface GenerateResponse {
  qrcode_key: string;
  url: string;
}

/** 打开系统浏览器(Windows start / macOS open / Linux xdg-open)。 */
export async function openBrowserDefault(url: string): Promise<void> {
  const platform = process.platform;
  const command =
    platform === "win32"
      ? { cmd: "cmd", args: ["/c", "start", "", url] }
      : platform === "darwin"
        ? { cmd: "open", args: [url] }
        : { cmd: "xdg-open", args: [url] };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.cmd, command.args, {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("spawn", () => resolve());
  });
}

/** 生成登录二维码,返回 key 与完整扫码 URL。B 站接口要求 GET。 */
async function generateQrcode(fetchImpl: typeof fetch): Promise<GenerateResponse> {
  let response: Response;
  try {
    response = await fetchImpl(GENERATE_URL, {
      headers: {
        "user-agent": USER_AGENT,
        referer: "https://passport.bilibili.com/login",
        accept: "application/json, text/plain, */*",
      },
    });
  } catch (error) {
    throw new BilibiliAuthError("NETWORK", "生成登录二维码失败", { cause: error });
  }
  const body = (await response.json()) as Record<string, unknown>;
  const code = Number(body.code ?? -1);
  if (code !== 0) {
    throw new BilibiliAuthError("API_ERROR", `生成登录二维码失败(code=${code})`, {
      apiCode: code,
      cause: body,
    });
  }
  const data = (body.data ?? {}) as Record<string, unknown>;
  const qrcodeKey = typeof data.qrcode_key === "string" ? data.qrcode_key : "";
  const url = typeof data.url === "string" ? data.url : "";
  if (qrcodeKey === "" || url === "") {
    throw new BilibiliAuthError("API_ERROR", "生成登录二维码响应缺少 qrcode_key", { cause: body });
  }
  return { qrcode_key: qrcodeKey, url };
}

interface PollOutcome {
  /** 0 成功 / -2 未扫码 / -4 过期 / -5 已扫未确认 / 其它视为失败。 */
  code: number;
  message: string;
  cookies?: string;
  refreshToken?: string;
}

/** 轮询扫码状态;成功时收集 Set-Cookie 与 refresh_token。 */
async function pollQrcode(qrcodeKey: string, fetchImpl: typeof fetch): Promise<PollOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${POLL_URL}?qrcode_key=${encodeURIComponent(qrcodeKey)}&source=main-fe-header`,
      {
        headers: {
          "user-agent": USER_AGENT,
          referer: "https://www.bilibili.com/",
          accept: "application/json, text/plain, */*",
        },
      },
    );
  } catch (error) {
    throw new BilibiliAuthError("NETWORK", "轮询登录状态失败", { cause: error });
  }
  const body = (await response.json()) as Record<string, unknown>;
  // 接口层错误(body.code !== 0):如风控 -412,直接失败。
  const bodyCode = Number(body.code ?? -1);
  if (bodyCode !== 0) {
    throw new BilibiliAuthError("API_ERROR", `轮询登录状态失败(code=${bodyCode})`, {
      apiCode: bodyCode,
      cause: body,
    });
  }
  const data = (body.data ?? {}) as Record<string, unknown>;
  // data.code 为扫码状态:B 站新版 86101=未扫码 / 86090=已失效 / 0=成功;
  // 旧版 -2=未扫码 / -4=已失效 / -5=已扫未确认。
  const code = Number(data.code ?? -2);
  const message = String(data.message ?? "");
  if (code === 0) {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    const pairs: string[] = [];
    for (const header of setCookies) {
      const eq = header.indexOf("=");
      if (eq <= 0) continue;
      pairs.push(`${header.slice(0, eq)}=${header.slice(eq + 1).split(";")[0]}`);
    }
    const cookies = pairs.join("; ");
    const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : "";
    if (cookies === "" || refreshToken === "") {
      throw new BilibiliAuthError("API_ERROR", "登录成功但响应缺少 cookie 或 refresh_token", {
        cause: body,
      });
    }
    return { code, message, cookies, refreshToken };
  }
  return { code, message };
}

/** B 站新版扫码状态码:已扫码待确认(继续等待)。 */
const SCANNED_CODES = new Set([86038, 86102, 86103, -5]);
/** B 站新版扫码状态码:二维码已失效(重新生成)。 */
const EXPIRED_CODES = new Set([86090, -4]);

/** 本地登录窗口的页面 HTML(内嵌二维码 PNG + 轮询脚本)。 */
function buildPage(qrDataUrl: string, token: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>哔哩哔哩扫码登录</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; flex-direction: column;
         align-items: center; justify-content: center; height: 100vh; margin: 0;
         background: #f5f6f7; color: #222; }
  h1 { font-size: 20px; margin-bottom: 8px; }
  .qr { background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  .qr img { display: block; width: 220px; height: 220px; }
  #status { margin-top: 16px; font-size: 15px; color: #666; min-height: 22px; }
  .ok { color: #00aeec; }
</style>
</head>
<body>
  <h1>哔哩哔哩扫码登录</h1>
  <div class="qr"><img src="${qrDataUrl}" alt="登录二维码"></div>
  <div id="status">请使用哔哩哔哩 App 扫码</div>
  <script>
    const token = ${JSON.stringify(token)};
    async function poll() {
      try {
        const res = await fetch('/status?token=' + token);
        const data = await res.json();
        const el = document.getElementById('status');
        el.textContent = data.message;
        if (data.state === 'success') {
          el.classList.add('ok');
          el.textContent = '登录成功,可关闭此页面';
          window.close();
          return;
        }
        if (data.state === 'expired') { location.reload(); return; }
        if (data.state === 'failed' || data.state === 'timeout') return;
      } catch { /* server closed */ }
      setTimeout(poll, 1000);
    }
    poll();
  </script>
</body>
</html>`;
}

/** 执行扫码登录:返回收集到的 cookie 与 refresh_token。 */
export async function qrcodeLogin(options: LoginOptions = {}): Promise<LoginResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxRegenerates = options.maxRegenerates ?? 3;
  const deadline = Date.now() + timeoutMs;

  // 一次性 token,防止本机其它进程误触发本地接口。
  const token = randomBytes(16).toString("hex");
  const state: { status: LoginStatus; qrDataUrl: string } = {
    status: { state: "waiting", message: "请使用哔哩哔哩 App 扫码" },
    qrDataUrl: "",
  };

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/status") {
      if (url.searchParams.get("token") !== token) {
        response.writeHead(403);
        response.end("forbidden");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(state.status));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(buildPage(state.qrDataUrl, token));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const pageUrl = `http://127.0.0.1:${port}/`;

  const emit = (status: LoginStatus): void => {
    state.status = status;
    options.onStatus?.(status);
  };

  try {
    for (let attempt = 0; attempt <= maxRegenerates; attempt += 1) {
      const { qrcode_key: qrcodeKey, url: scanUrl } = await generateQrcode(fetchImpl);
      // 用 PNG data URL(SVG 带 XML 声明,内嵌 HTML 可能不渲染)。
      state.qrDataUrl = await QRCode.toDataURL(scanUrl, { margin: 1, width: 280 });
      emit({ state: "waiting", message: "请使用哔哩哔哩 App 扫码" });

      if (options.autoOpenBrowser !== false) {
        const opener = options.openBrowser ?? openBrowserDefault;
        try {
          await opener(pageUrl);
        } catch (error) {
          emit({ state: "waiting", message: "自动打开浏览器失败,请手动访问二维码链接" });
          void error;
        }
      } else {
        emit({ state: "waiting", message: `请访问 ${scanUrl} 扫码(或使用终端二维码)` });
      }

      // 轮询直到成功 / 超时 / 二维码过期。
      for (;;) {
        if (Date.now() >= deadline) {
          emit({ state: "timeout", message: "登录超时,请重试" });
          throw new BilibiliAuthError("LOGIN_REQUIRED", "登录超时,请重新执行 login");
        }
        const outcome = await pollQrcode(qrcodeKey, fetchImpl);
        if (outcome.code === 0) {
          emit({ state: "success", message: "登录成功" });
          // 给页面一点时间展示成功状态。
          await new Promise((resolve) => setTimeout(resolve, 800));
          return { cookies: outcome.cookies!, refreshToken: outcome.refreshToken! };
        }
        if (EXPIRED_CODES.has(outcome.code)) {
          emit({ state: "expired", message: "二维码已过期,正在重新生成" });
          break; // 重新生成二维码
        }
        if (SCANNED_CODES.has(outcome.code)) {
          emit({ state: "scanned", message: "已扫码,请在手机上确认" });
        } else if (outcome.code !== 86101 && outcome.code !== -2) {
          // 未知状态码:不打断用户扫码,交给超时兜底。
          emit({ state: "waiting", message: `等待扫码(${outcome.code})` });
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
    emit({ state: "failed", message: "二维码多次过期,请重试" });
    throw new BilibiliAuthError("LOGIN_REQUIRED", "二维码多次过期,请重新执行 login");
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
