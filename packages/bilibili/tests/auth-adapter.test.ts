import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { bilibiliQrAdapter, type BilibiliCredentials } from "../src/auth/index.js";

interface PassportMock {
  url: string;
  server: Server;
  generateCalls: number;
  pollCalls: number;
  refreshCalls: number;
  close(): Promise<void>;
}

/** 模拟 passport 接口:generate + 可编程 poll 状态序列 + refresh。 */
async function startPassportMock(options: {
  pollStates?: Array<{ code: number; message?: string }>;
  successCookies?: string[];
  refreshToken?: string;
  refreshResponse?: { code: number; refreshToken?: string; setCookies?: string[] };
}): Promise<PassportMock> {
  let generateCalls = 0;
  let pollCalls = 0;
  let refreshCalls = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/x/passport-login/web/qrcode/generate") {
      generateCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          code: 0,
          data: {
            url: "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=KEY",
            qrcode_key: "KEY",
          },
        }),
      );
      return;
    }
    if (url.pathname === "/x/passport-login/web/qrcode/poll") {
      const states = options.pollStates ?? [{ code: -2 }];
      const state = states[Math.min(pollCalls, states.length - 1)] ?? { code: -2 };
      pollCalls += 1;
      if (state.code === 0) {
        response.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": options.successCookies ?? ["SESSDATA=final; path=/"],
        });
        response.end(
          JSON.stringify({
            code: 0,
            data: {
              code: 0,
              message: "扫码成功",
              refresh_token: options.refreshToken ?? "refresh-token",
            },
          }),
        );
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ code: 0, data: { code: state.code, message: state.message ?? "" } }),
      );
      return;
    }
    if (url.pathname === "/x/passport-login/web/cookie/refresh") {
      refreshCalls += 1;
      const rr = options.refreshResponse ?? { code: 0, refreshToken: "rt-new" };
      if (rr.code !== 0) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: rr.code, message: "refresh failed" }));
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": rr.setCookies ?? ["SESSDATA=new-sess; path=/", "bili_jct=new-jct; path=/"],
      });
      response.end(JSON.stringify({ code: 0, data: { refresh_token: rr.refreshToken } }));
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    get generateCalls() {
      return generateCalls;
    },
    get pollCalls() {
      return pollCalls;
    },
    get refreshCalls() {
      return refreshCalls;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const mocks: PassportMock[] = [];

afterEach(async () => {
  for (const mock of mocks.splice(0)) {
    await mock.close();
  }
});

/** 把 passport 请求重定向到 mock server。 */
function redirectFetch(mockUrl: string): typeof fetch {
  return (input, init) => {
    const url = String(input).replace("https://passport.bilibili.com", mockUrl);
    return fetch(url, init);
  };
}

const adapter = bilibiliQrAdapter();

describe("bilibiliQrAdapter generateKey", () => {
  it("生成二维码 key 与扫码 URL", async () => {
    const mock = await startPassportMock({});
    mocks.push(mock);
    const result = await adapter.generateKey(redirectFetch(mock.url));
    expect(result.key).toBe("KEY");
    expect(result.url).toContain("qrcode_key=KEY");
  });

  it("响应缺 qrcode_key 抛 API_ERROR", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: 0, data: { url: "https://x" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(
        adapter.generateKey(
          (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
            const url = String(input).replace(
              "https://passport.bilibili.com",
              `http://127.0.0.1:${port}`,
            );
            return fetch(url, init);
          }) as typeof fetch,
        ),
      ).rejects.toMatchObject({ code: "API_ERROR" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("bilibiliQrAdapter pollStatus", () => {
  it("-2 未扫 → -5 已扫 → 0 成功,收集 Set-Cookie 与 refresh_token", async () => {
    const mock = await startPassportMock({
      pollStates: [{ code: -2 }, { code: -5, message: "已扫码未确认" }, { code: 0 }],
      successCookies: [
        "SESSDATA=final-sess; path=/",
        "bili_jct=final-jct; path=/",
        "DedeUserID=42; path=/",
      ],
      refreshToken: "rt-1",
    });
    mocks.push(mock);
    const states: string[] = [];
    // 手动走状态机。
    const key = (await adapter.generateKey(redirectFetch(mock.url))).key;
    for (let i = 0; i < 4; i += 1) {
      const outcome = await adapter.pollStatus(key, redirectFetch(mock.url));
      states.push(outcome.state);
      if (outcome.state === "success") {
        const cred = outcome.credentials as BilibiliCredentials;
        expect(cred.cookies).toBe("SESSDATA=final-sess; bili_jct=final-jct; DedeUserID=42");
        expect(cred.refreshToken).toBe("rt-1");
        break;
      }
    }
    expect(states).toEqual(["waiting", "scanned", "success"]);
  });

  it("-4 二维码过期映射为 expired", async () => {
    const mock = await startPassportMock({ pollStates: [{ code: -4 }] });
    mocks.push(mock);
    const outcome = await adapter.pollStatus("k", redirectFetch(mock.url));
    expect(outcome.state).toBe("expired");
  });

  it("86101 新版未扫码映射为 waiting", async () => {
    const mock = await startPassportMock({ pollStates: [{ code: 86101 }] });
    mocks.push(mock);
    const outcome = await adapter.pollStatus("k", redirectFetch(mock.url));
    expect(outcome.state).toBe("waiting");
  });

  it("成功但响应缺少 SESSDATA 抛 API_ERROR", async () => {
    const mock = await startPassportMock({
      pollStates: [{ code: 0 }],
      successCookies: ["bili_jct=only; path=/"],
    });
    mocks.push(mock);
    await expect(adapter.pollStatus("k", redirectFetch(mock.url))).rejects.toMatchObject({
      code: "API_ERROR",
    });
  });
});

describe("bilibiliQrAdapter refresh", () => {
  it("refresh_token 换新 cookie,保留 buvid3", async () => {
    const mock = await startPassportMock({
      refreshResponse: {
        code: 0,
        refreshToken: "rt-new",
        setCookies: ["SESSDATA=new-sess; path=/", "bili_jct=new-jct; path=/"],
      },
    });
    mocks.push(mock);
    const refreshed = await adapter.refresh!(
      { cookies: "SESSDATA=old; bili_jct=old-jct", refreshToken: "rt-old", buvid3: "b3" },
      redirectFetch(mock.url),
    );
    expect(refreshed.cookies).toContain("SESSDATA=new-sess");
    expect(refreshed.cookies).toContain("bili_jct=new-jct");
    expect(refreshed.refreshToken).toBe("rt-new");
    expect(refreshed.buvid3).toBe("b3");
  });

  it("缺少 bili_jct 抛 AUTH_EXPIRED", async () => {
    const mock = await startPassportMock({});
    mocks.push(mock);
    await expect(
      adapter.refresh!({ cookies: "SESSDATA=x", refreshToken: "rt" }, redirectFetch(mock.url)),
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
  });

  it("refresh_token 失效(code != 0)抛 AUTH_EXPIRED", async () => {
    const mock = await startPassportMock({ refreshResponse: { code: -101 } });
    mocks.push(mock);
    await expect(
      adapter.refresh!(
        { cookies: "SESSDATA=x; bili_jct=j", refreshToken: "rt" },
        redirectFetch(mock.url),
      ),
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
  });
});

describe("bilibiliQrAdapter serialize / deserialize", () => {
  it("往返一致", () => {
    const cred: BilibiliCredentials = {
      cookies: "SESSDATA=a; bili_jct=b",
      refreshToken: "rt",
      buvid3: "b3",
    };
    const payload = adapter.serialize(cred, "2026-01-01T00:00:00.000Z");
    expect(payload.platform).toBe("bilibili");
    expect(payload.savedAt).toBe("2026-01-01T00:00:00.000Z");
    const back = adapter.deserialize(payload);
    expect(back).toEqual(cred);
  });

  it("platform 不匹配返回 null", () => {
    const payload = adapter.serialize(
      { cookies: "a", refreshToken: "rt" },
      "2026-01-01T00:00:00.000Z",
    );
    const other = { ...payload, platform: "netease-music" };
    expect(adapter.deserialize(other)).toBeNull();
  });

  it("凭证缺少 cookies/refreshToken 返回 null", () => {
    expect(
      adapter.deserialize({
        platform: "bilibili",
        credentials: { cookies: "" },
        savedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("兼容老格式(顶层 cookies/refreshToken 字段)", () => {
    const legacy = {
      cookies: "SESSDATA=legacy; bili_jct=j",
      refreshToken: "legacy-rt",
      savedAt: "2026-01-01T00:00:00.000Z",
    };
    const back = adapter.deserialize(legacy as never);
    expect(back).toEqual({ cookies: "SESSDATA=legacy; bili_jct=j", refreshToken: "legacy-rt" });
  });
});
