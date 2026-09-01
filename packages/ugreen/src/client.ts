import { createLogger } from "@sakurachiyo0v0/logger";
import { createMemoryCookieStore } from "./cookie-store.js";
import { UgAppError } from "./errors.js";
import { httpRequest } from "./http.js";
import { acquireCookie, resolveConfig, type ResolvedConfig } from "./session.js";
import type { CookieStore, ListResult, TestResult, UgAppClient, UgAppConfig, UploadResult } from "./types.js";

const logger = createLogger({ namespace: "ugreen" }).child("client");

/** 清洗文件名：Windows 保留字符替换为 _，去掉首尾空白 */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[\\/:*?"<>|]/g, "_").trim();
}

/** 拼接 dav 路径：确保 baseDir 与文件名之间只有一个 / */
function davPath(baseDir: string, name: string): string {
  return `/dav${baseDir.replace(/\/+$/, "")}/${name}`;
}

/** 从 PROPFIND 207 响应体提取 displayname 列表 */
function parseDisplayNames(body: Buffer): string[] {
  return [...body.toString().matchAll(/<[Dd]:displayname>([^<]+)<\/[Dd]:displayname>/g)].map((m) => m[1] ?? "");
}

/** 列出目录（test 与 list 共用）：登录 + PROPFIND */
async function listDir(
  cfg: ResolvedConfig,
  basic: string,
  acquire: () => Promise<string>,
  dirPath: string | undefined
): Promise<ListResult> {
  const dir = (dirPath ?? cfg.baseDir).replace(/\/+$/, "");
  try {
    const cookie = await acquire();
    const res = await httpRequest(cfg.appHost, "PROPFIND", encodeURI(`/dav${dir}`), {
      headers: { Authorization: basic, Depth: "1", "Content-Type": "application/xml" },
      cookie,
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>',
      timeoutMs: cfg.timeoutMs,
    });
    if (res.status === 207) {
      return { ok: true, entries: parseDisplayNames(res.body) };
    }
    if (res.status === 302 || res.status === 401) {
      return { ok: false, message: "目录无访问权限（检查用户名/密码与目录路径）" };
    }
    return { ok: false, message: `PROPFIND 失败（HTTP ${res.status}）` };
  } catch (err) {
    const msg = err instanceof UgAppError ? err.message : err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg };
  }
}

/** 创建 UGOS 客户端：自动登录 + cookie 缓存 + 上传/列目录/测试 */
export function createUgAppClient(config: UgAppConfig): UgAppClient {
  const cfg = resolveConfig(config);
  const store: CookieStore = config.cookieStore ?? createMemoryCookieStore();
  const acquire = () => acquireCookie(cfg, store);
  const basic = "Basic " + Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");

  return {
    acquireCookie: acquire,

    async test(): Promise<TestResult> {
      const r = await listDir(cfg, basic, acquire, undefined);
      return r.ok ? { ok: true, entries: r.entries } : { ok: false, message: r.message };
    },

    async list(dirPath?: string): Promise<ListResult> {
      return listDir(cfg, basic, acquire, dirPath);
    },

    async upload(filename, content, options): Promise<UploadResult> {
      const safeName = sanitizeFilename(filename);
      if (!safeName) return { ok: false, error: "文件名不合法" };
      const dir = (options?.dirPath ?? cfg.baseDir).replace(/\/+$/, "");
      const remotePath = `${dir}/${safeName}`;
      const body = Buffer.isBuffer(content) ? content : Buffer.from(content);

      const doPut = async (cookie: string) =>
        httpRequest(cfg.appHost, "PUT", encodeURI(davPath(dir, safeName)), {
          headers: { Authorization: basic, "Content-Type": "application/octet-stream" },
          cookie,
          body,
          timeoutMs: cfg.timeoutMs,
        });

      try {
        let res = await doPut(await acquire());
        if (res.status === 302 || res.status === 401) {
          // 会话失效：清缓存重登再试一次
          store.clear?.();
          logger.info("session expired, re-login and retry", { status: res.status });
          res = await doPut(await acquire());
        }
        if (res.status === 201 || res.status === 200 || res.status === 204) {
          return { ok: true, path: remotePath, status: res.status };
        }
        return { ok: false, status: res.status, error: res.body.toString().slice(0, 200) || `HTTP ${res.status}` };
      } catch (err) {
        const msg = err instanceof UgAppError ? err.message : err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  };
}
