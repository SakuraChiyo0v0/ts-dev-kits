/**
 * 扫码登录骨架 —— 生成二维码、弹出本地窗口(系统浏览器 + 本地页面)、
 * 轮询确认后通过平台适配器收集凭证并落盘。
 *
 * 平台差异全部收敛在 QrLoginAdapter(generateKey / pollStatus / serialize / deserialize),
 * 本文件不感知具体平台。流程参照 bilibili-auth 已验证的登录体验。
 */
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { AccountError } from "./errors.js";
import type {
  LoginResult,
  LoginStatus,
  LoginState,
  QrLoginAdapter,
  QrLoginOptions,
} from "./types.js";

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

/** 本地登录窗口的页面 HTML(内嵌二维码 PNG + 轮询脚本)。 */
function buildPage(
  qrDataUrl: string,
  token: string,
  platformName: string,
): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${platformName} 扫码登录</title>
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
  <h1>${platformName} 扫码登录</h1>
  <div class="qr"><img src="${qrDataUrl}" alt="登录二维码"></div>
  <div id="status">请使用 ${platformName} App 扫码</div>
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

/** 执行扫码登录:通过适配器收集凭证,可选持久化。 */
export async function qrcodeLogin(options: QrLoginOptions): Promise<LoginResult> {
  const { adapter, store } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxRegenerates = options.maxRegenerates ?? 3;
  const deadline = Date.now() + timeoutMs;

  // 一次性 token,防止本机其它进程误触发本地接口。
  const token = randomBytes(16).toString("hex");
  const state: { status: LoginStatus; qrDataUrl: string } = {
    status: { state: "waiting", message: `请使用 ${adapter.platform} App 扫码` },
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
    response.end(buildPage(state.qrDataUrl, token, adapter.platform));
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
      let key: string;
      let scanUrl: string;
      try {
        const generated = await adapter.generateKey(fetchImpl);
        key = generated.key;
        scanUrl = generated.url;
      } catch (error) {
        if (error instanceof AccountError) {
          throw error;
        }
        throw new AccountError("NETWORK", "生成登录二维码失败", { cause: error });
      }
      // 用 PNG data URL(SVG 带 XML 声明,内嵌 HTML 可能不渲染)。
      state.qrDataUrl = await QRCode.toDataURL(scanUrl, { margin: 1, width: 280 });
      // 每次生成/重生成都把二维码图片吐给调用方(远程/聊天渠道展示给用户扫码)。
      options.onQrCode?.(state.qrDataUrl);
      emit({ state: "waiting", message: `请使用 ${adapter.platform} App 扫码` });

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
          throw new AccountError("LOGIN_REQUIRED", "登录超时,请重新执行 login");
        }
        let outcome: Awaited<ReturnType<QrLoginAdapter["pollStatus"]>>;
        try {
          outcome = await adapter.pollStatus(key, fetchImpl);
        } catch (error) {
          if (error instanceof AccountError) {
            throw error;
          }
          throw new AccountError("NETWORK", "轮询登录状态失败", { cause: error });
        }
        if (outcome.state === "success") {
          if (outcome.credentials === undefined) {
            throw new AccountError("API_ERROR", "登录成功但适配器未返回凭证");
          }
          emit({ state: "success", message: "登录成功" });
          if (store !== undefined) {
            const payload = adapter.serialize(
              outcome.credentials,
              new Date().toISOString(),
            );
            await store.save(payload);
          }
          // 给页面一点时间展示成功状态。
          await new Promise((resolve) => setTimeout(resolve, 800));
          return { credentials: outcome.credentials, saved: store !== undefined };
        }
        if (outcome.state === "expired") {
          emit({ state: "expired", message: "二维码已过期,正在重新生成" });
          break; // 重新生成二维码
        }
        if (outcome.state === "scanned") {
          emit({ state: "scanned", message: "已扫码,请在手机上确认" });
        } else if (outcome.message !== "") {
          emit({ state: "waiting", message: outcome.message });
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
    emit({ state: "failed", message: "二维码多次过期,请重试" });
    throw new AccountError("LOGIN_REQUIRED", "二维码多次过期,请重新执行 login");
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** 判断某个登录状态是否为终态。 */
export function isTerminalState(state: LoginState): boolean {
  return state === "success" || state === "timeout" || state === "failed";
}
