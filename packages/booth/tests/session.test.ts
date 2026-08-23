import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuthStore } from "@sakurachiyo0v0/account";
import {
  BoothSession,
  parseCookieString,
  cookieStringify,
  collectSetCookies,
} from "../src/session.js";

describe("cookie 工具", () => {
  it("parseCookieString 解析键值", () => {
    const map = parseCookieString("_pixiv_session=abc123; __csrf_token=xyz; empty=");
    expect(map["_pixiv_session"]).toBe("abc123");
    expect(map["__csrf_token"]).toBe("xyz");
    expect(map["empty"]).toBe("");
  });

  it("parseCookieString 跳过无等号片段", () => {
    const map = parseCookieString("noseparator; a=b");
    expect(map["a"]).toBe("b");
    expect(map["noseparator"]).toBeUndefined();
  });

  it("cookieStringify 往返", () => {
    const original = "_pixiv_session=abc; __csrf_token=xyz";
    const map = parseCookieString(original);
    const again = parseCookieString(cookieStringify(map));
    expect(again["_pixiv_session"]).toBe("abc");
    expect(again["__csrf_token"]).toBe("xyz");
  });

  it("collectSetCookies 提取 Set-Cookie", () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "_pixiv_session=session123; Path=/; HttpOnly");
    headers.append("Set-Cookie", "foo=bar; Path=/");
    const map = collectSetCookies(headers);
    expect(map["_pixiv_session"]).toBe("session123");
    expect(map["foo"]).toBe("bar");
  });
});

describe("BoothSession", () => {
  it("显式 cookie 优先", () => {
    const session = new BoothSession({ cookie: "_pixiv_session=explicit" });
    expect(session.isLoggedIn).toBe(true);
    expect(session.cookieValue("_pixiv_session")).toBe("explicit");
  });

  it("无 cookie 且无存储时视为未登录", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "booth-session-empty-"));
    try {
      // 指向不存在的 auth 文件,避免读到真实用户存储。
      const session = new BoothSession({ authPath: path.join(dir, "nope", "auth.json") });
      expect(session.isLoggedIn).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("从 AuthStore 回退加载", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "booth-session-"));
    try {
      const authPath = path.join(dir, "auth.json");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        authPath,
        JSON.stringify({
          platform: "booth",
          credentials: { cookies: "_pixiv_session=from-store" },
          savedAt: new Date().toISOString(),
        }),
        "utf-8",
      );
      const session = new BoothSession({ authPath });
      expect(session.isLoggedIn).toBe(true);
      expect(session.cookieValue("_pixiv_session")).toBe("from-store");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolveUrl 拼接相对路径", () => {
    const session = new BoothSession({ baseUrl: "http://127.0.0.1:9999" });
    expect(session.resolveUrl("/ja/items/1")).toBe("http://127.0.0.1:9999/ja/items/1");
    expect(session.resolveUrl("ja/items/1")).toBe("http://127.0.0.1:9999/ja/items/1");
    expect(session.resolveUrl("https://other.example/x")).toBe("https://other.example/x");
  });

  it("request 附加 Cookie 头并合并 Set-Cookie", async () => {
    let capturedCookie: string | null = null;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      capturedCookie = headers.get("cookie");
      expect(url).toBe("http://127.0.0.1:9999/test");
      const response = new Response('{"ok":true}', { status: 200 });
      response.headers.append("Set-Cookie", "new_cookie=from-server; Path=/");
      return response;
    };
    const session = new BoothSession({
      baseUrl: "http://127.0.0.1:9999",
      fetchImpl: fetchImpl as typeof fetch,
      cookie: "_pixiv_session=abc",
    });
    const response = await session.request("/test");
    expect(response.status).toBe(200);
    expect(capturedCookie).toContain("_pixiv_session=abc");
    expect(session.cookieValue("new_cookie")).toBe("from-server");
  });

  it("request 网络错误归类为 BoothError NETWORK", async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new TypeError("fetch failed");
    };
    const session = new BoothSession({
      baseUrl: "http://127.0.0.1:9999",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(session.request("/test")).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("persist 写入 AuthStore 后可被重新加载", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "booth-persist-"));
    try {
      const authPath = path.join(dir, "auth.json");
      const session = new BoothSession({ cookie: "_pixiv_session=persisted-cookie" });
      await session.persist(authPath);
      const text = readFileSync(authPath, "utf-8");
      const payload = JSON.parse(text);
      expect(payload.platform).toBe("booth");
      expect(payload.credentials.cookies).toContain("_pixiv_session=persisted-cookie");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
