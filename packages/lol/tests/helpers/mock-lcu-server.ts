/**
 * 本地 mock LCU 服务器：Node http + ws 实现，模拟客户端本机接口。
 * 用于测试走真实 HTTP/WebSocket 协议路径（仿照 email 包 smtp-test-server 的做法）。
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

export interface MockRouteHandler {
  (ctx: {
    url: URL;
    body: unknown;
    auth: { user: string; pass: string } | null;
    method: string;
  }): { status?: number; body?: unknown; headers?: Record<string, string> } | Promise<{
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
  }>;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  auth: { user: string; pass: string } | null;
}

export interface MockLcuServerOptions {
  token?: string;
  /** 挂起响应（毫秒），用于超时测试 */
  delayMs?: number;
}

export class MockLcuServer {
  readonly httpServer: http.Server;
  readonly wss: WebSocketServer;
  readonly requests: RecordedRequest[] = [];
  readonly subscriptions = new Map<WebSocket, Set<string>>();

  private readonly token: string;
  private readonly delayMs: number;
  private readonly routes = new Map<string, MockRouteHandler>();
  private fallbackHandler: MockRouteHandler | null = null;
  private port: number | null = null;

  private constructor(options: MockLcuServerOptions) {
    this.token = options.token ?? "test-token";
    this.delayMs = options.delayMs ?? 0;
    this.httpServer = http.createServer((req, res) => {
      // 客户端中止请求时 handleHttp 内部会 reject，吞掉避免未处理 rejection
      void this.handleHttp(req, res).catch(() => {});
    });
    this.wss = new WebSocketServer({ server: this.httpServer, path: "/" });

    this.wss.on("connection", (socket) => {
      this.subscriptions.set(socket, new Set());
      socket.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as unknown;
          if (Array.isArray(msg) && typeof msg[1] === "string") {
            this.subscriptions.get(socket)?.add(msg[1]);
          }
        } catch {
          // 忽略非法消息
        }
      });
      socket.on("close", () => {
        this.subscriptions.delete(socket);
      });
    });
  }

  static async start(options: MockLcuServerOptions = {}): Promise<MockLcuServer> {
    const server = new MockLcuServer(options);
    await new Promise<void>((resolve) => {
      server.httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.httpServer.address();
    server.port = typeof address === "object" && address ? address.port : null;
    return server;
  }

  getPort(): number {
    if (this.port === null) {
      throw new Error("mock server not listening");
    }
    return this.port;
  }

  /** 注册路由：method + path 精确匹配 */
  route(method: string, path: string, handler: MockRouteHandler): void {
    this.routes.set(`${method} ${path}`, handler);
  }

  /** 注册兜底路由：未精确匹配任意请求时调用（仅用于测试便利） */
  routeFallback(handler: MockRouteHandler): void {
    this.fallbackHandler = handler;
  }

  /** 向订阅了指定事件的连接广播事件 */
  broadcast(eventName: string, payload: { uri: string; eventType: string; data: unknown }): void {
    const message = JSON.stringify([8, eventName, payload]);
    for (const [socket, names] of this.subscriptions) {
      if (names.has(eventName) && socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    }
  }

  async stop(): Promise<void> {
    for (const socket of this.subscriptions.keys()) {
      socket.close();
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    // 立即断开残余连接，避免 server.close() 等待挂起请求
    this.httpServer.closeAllConnections();
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()));
  }

  /** 安全结束响应：客户端已断开时静默吞掉写错误 */
  private static safeEnd(res: ServerResponse, status: number, headers: Record<string, string>, body?: unknown): void {
    try {
      res.writeHead(status, headers);
      if (body === undefined) {
        res.end();
      } else if (typeof body === "string" || Buffer.isBuffer(body)) {
        res.end(body);
      } else {
        res.end(JSON.stringify(body));
      }
    } catch {
      // 客户端已关闭连接，忽略
    }
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 客户端中途断开（如超时中止）时，吞掉 req/res 的 aborted/error 事件，避免未处理 rejection
    req.on("error", () => {});
    req.on("aborted", () => {});
    res.on("error", () => {});

    await new Promise((resolve) => setTimeout(resolve, this.delayMs));

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");

    let body: unknown;
    if (rawBody.length > 0) {
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        body = rawBody;
      }
    }

    const authHeader = req.headers.authorization;
    let auth: { user: string; pass: string } | null = null;
    if (authHeader?.startsWith("Basic ")) {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      auth = {
        user: decoded.slice(0, sep),
        pass: decoded.slice(sep + 1),
      };
    }

    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      query[key] = value;
    }

    this.requests.push({ method: req.method ?? "GET", path: url.pathname, query, body, auth });

    // 认证校验
    if (!auth || auth.pass !== this.token) {
      MockLcuServer.safeEnd(res, 401, { "Content-Type": "application/json" }, {
        errorCode: "UNAUTHORIZED",
        httpStatus: 401,
      });
      return;
    }

    const routeKey = `${req.method} ${url.pathname}`;
    const handler = this.routes.get(routeKey);
    if (!handler && this.fallbackHandler) {
      try {
        const result = await this.fallbackHandler({ url, body, auth, method: req.method ?? "GET" });
        const status = result.status ?? 200;
        const headers = result.headers ?? { "Content-Type": "application/json" };
        MockLcuServer.safeEnd(res, status, headers, result.body);
        return;
      } catch {
        // 兜底失败继续走 404
      }
    }
    if (!handler) {
      MockLcuServer.safeEnd(res, 404, { "Content-Type": "application/json" }, {
        errorCode: "NOT_FOUND",
        httpStatus: 404,
      });
      return;
    }

    try {
      const result = await handler({ url, body, auth, method: req.method ?? "GET" });
      const status = result.status ?? 200;
      const headers = result.headers ?? { "Content-Type": "application/json" };
      MockLcuServer.safeEnd(res, status, headers, result.body);
    } catch (error) {
      MockLcuServer.safeEnd(res, 500, { "Content-Type": "application/json" }, {
        errorCode: "INTERNAL",
        httpStatus: 500,
        message: String(error),
      });
    }
  }
}
