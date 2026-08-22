import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { qrcodeLogin } from "../src/index.js";

interface PassportMock {
  url: string;
  server: Server;
  generateCalls: number;
  pollCalls: number;
  close(): Promise<void>;
}

/** 模拟 passport 接口:generate + 可编程 poll 状态序列。 */
async function startPassportMock(options: {
  pollStates: Array<{ code: number; message?: string }>;
  successCookies?: string[];
  refreshToken?: string;
}): Promise<PassportMock> {
  let generateCalls = 0;
  let pollCalls = 0;
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
      const state = options.pollStates[Math.min(pollCalls, options.pollStates.length - 1)] ?? {
        code: -2,
      };
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

describe("qrcodeLogin", () => {
  it("完整流程:-2 未扫 → -5 已扫 → 0 成功,自动收集 cookie 与 refresh_token", async () => {
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
    const statuses: string[] = [];
    const result = await qrcodeLogin({
      fetchImpl: redirectFetch(mock.url),
      autoOpenBrowser: false,
      pollIntervalMs: 10,
      timeoutMs: 5000,
      onStatus: (status) => statuses.push(status.state),
    });
    expect(result.cookies).toBe("SESSDATA=final-sess; bili_jct=final-jct; DedeUserID=42");
    expect(result.refreshToken).toBe("rt-1");
    // autoOpenBrowser=false 时额外提示"手动访问链接"(仍为 waiting)。
    expect(statuses).toEqual(["waiting", "waiting", "scanned", "success"]);
    expect(mock.pollCalls).toBeGreaterThanOrEqual(3);
  });

  it("二维码过期(-4)后自动重新生成并继续", async () => {
    const mock = await startPassportMock({
      pollStates: [{ code: -2 }, { code: -4, message: "二维码已失效" }, { code: 0 }],
      successCookies: ["SESSDATA=final2; path=/"],
      refreshToken: "rt-2",
    });
    mocks.push(mock);
    const result = await qrcodeLogin({
      fetchImpl: redirectFetch(mock.url),
      autoOpenBrowser: false,
      pollIntervalMs: 10,
      timeoutMs: 5000,
    });
    expect(result.cookies).toContain("SESSDATA=final2");
    expect(mock.generateCalls).toBeGreaterThanOrEqual(2);
  });

  it("超时抛 LOGIN_REQUIRED", async () => {
    const mock = await startPassportMock({ pollStates: [{ code: -2 }] });
    mocks.push(mock);
    await expect(
      qrcodeLogin({
        fetchImpl: redirectFetch(mock.url),
        autoOpenBrowser: false,
        pollIntervalMs: 10,
        timeoutMs: 80,
      }),
    ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  });

  it("autoOpenBrowser 控制是否调用浏览器打开器", async () => {
    const mock = await startPassportMock({ pollStates: [{ code: 0 }], successCookies: ["SESSDATA=a"] });
    mocks.push(mock);
    const opener = vi.fn();

    await qrcodeLogin({
      fetchImpl: redirectFetch(mock.url),
      autoOpenBrowser: true,
      openBrowser: opener,
      pollIntervalMs: 10,
      timeoutMs: 5000,
    });
    expect(opener).toHaveBeenCalledTimes(1);

    await qrcodeLogin({
      fetchImpl: redirectFetch(mock.url),
      autoOpenBrowser: false,
      openBrowser: opener,
      pollIntervalMs: 10,
      timeoutMs: 5000,
    });
    expect(opener).toHaveBeenCalledTimes(1); // 未再调用
  });
});
