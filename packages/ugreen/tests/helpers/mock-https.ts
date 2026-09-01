import { EventEmitter } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import type { RequestOptions } from "node:https";
import { vi } from "vitest";

function normalizeHeaders(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries((headers ?? {}) as Record<string, unknown>)) {
    out[k.toLowerCase()] = String(v);
  }
  return out;
}

export type MockCall = {
  host: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Buffer;
};

export type MockResponse = {
  status: number;
  headers?: Record<string, string | string[] | undefined>;
  body?: string | Buffer;
};

/** 按调用顺序消费 handler 的假 HTTPS 服务端；用 vi.mocked(https.request).mockImplementation 安装 */
export class MockServer {
  calls: MockCall[] = [];
  private handlers: Array<(call: MockCall) => MockResponse | Promise<MockResponse>> = [];

  install(requestMock: ReturnType<typeof vi.fn>): void {
    requestMock.mockImplementation((opts: RequestOptions, cb?: (res: EventEmitter) => void) => {
      const call: MockCall = {
        host: opts.host as string,
        method: opts.method as string,
        path: opts.path as string,
        headers: normalizeHeaders(opts.headers),
        body: Buffer.alloc(0),
      };
      this.calls.push(call);
      const req = new EventEmitter() as EventEmitter & {
        write: (c: unknown) => void;
        end: () => void;
        destroy: (e?: unknown) => void;
      };
      req.write = (c: unknown) => {
        call.body = Buffer.concat([call.body, Buffer.from(c as Buffer | string)]);
      };
      req.end = vi.fn();
      req.destroy = vi.fn();
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string | string[] | undefined> };
      res.statusCode = 200;
      res.headers = {};
      if (cb) cb(res);
      queueMicrotask(async () => {
        try {
          const handler: (call: MockCall) => MockResponse | Promise<MockResponse> = this.handlers.shift() ?? (() => ({ status: 200, body: "" }));
          const r = await handler(call);
          res.statusCode = r.status;
          res.headers = r.headers ?? {};
          const buf = Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body ?? "");
          res.emit("data", buf);
          res.emit("end");
        } catch (err) {
          req.emit("error", err);
        }
      });
      return req;
    });
  }

  push(handler: (call: MockCall) => MockResponse | Promise<MockResponse>): void {
    this.handlers.push(handler);
  }

  clear(): void {
    this.calls.length = 0;
    this.handlers.length = 0;
  }
}

/** 推入一次完整登录链路的 4 步响应（check / login / onceToken / auth） */
export function genRsaPem(): string {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  return publicKey.export({ type: "pkcs1", format: "pem" }).toString();
}

export function pushLoginFlow(server: MockServer, finalCookie = "final-cookie-1"): string {
  const pubPem = genRsaPem();
  server.push(() => ({
    status: 200,
    headers: { "x-rsa-token": Buffer.from(pubPem, "utf8").toString("base64") },
    body: "",
  }));
  server.push(() => ({
    status: 200,
    headers: { "set-cookie": ["token=ug-token; Path=/; HttpOnly"] },
    body: JSON.stringify({
      code: 200,
      data: { token: "api-token", public_key: Buffer.from(pubPem, "utf8").toString("base64") },
    }),
  }));
  server.push(() => ({
    status: 200,
    body: JSON.stringify({ code: 200, data: { token: "ot-token" } }),
  }));
  server.push(() => ({
    status: 200,
    body: `<html><script>document.cookie="ugreen-proxy-token=${finalCookie}; Max-Age=600; Path=/"</script></html>`,
  }));
  return pubPem;
}

export const TEST_CONFIG = {
  appHost: "app-fcbab9b4f9a92a3aa980-dxp4800gt-114a.cn30.ugapp.link",
  proxyId: "fcbab9b4f9a92a3aa980",
  username: "AmeChan",
  password: "test-password",
  baseDir: "/DXP4800GT/AmeChan/下载",
};


