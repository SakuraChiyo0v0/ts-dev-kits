/**
 * 真实 LCU 传输层实现：
 * - REST：undici fetch + Agent（忽略自签名证书）+ BasicAuth(riot:token)
 * - 信号量限流（LCU「一碰就碎」）
 * - GET 幂等请求自动重试（指数退避），写操作不重试
 * - WebSocket：ws 包订阅 OnJsonApiEvent，断线自动重连
 */

import { Agent, fetch } from "undici";
import WebSocket, { type RawData } from "ws";

import { createLogger } from "@sakurachiyo0v0/logger";
import { LolError } from "./errors.js";
import type { LcuEvent, LcuEventType } from "./types.js";
import type { LcuTransport, RawResponse, RequestOptions } from "./transport.js";

const logger = createLogger({ namespace: "lol" }).child("http-transport");

export interface HttpTransportOptions {
  port: number;
  token: string;
  scheme?: "http" | "https";
  concurrency?: number;
  timeoutMs?: number;
  /** WebSocket 重连最大尝试次数，默认 5；0 表示不重连 */
  maxReconnectAttempts?: number;
}

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 250;

/** 计数信号量：限制同时进行的请求数 */
class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly limit: number) {}

  acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.release);
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve(this.release);
      });
    });
  }

  private readonly release = (): void => {
    this.active -= 1;
    this.drain();
  };

  private drain(): void {
    while (this.active < this.limit && this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    }
  }
}

export class HttpLcuTransport implements LcuTransport {
  private readonly baseUrl: string;
  private readonly scheme: "http" | "https";
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly dispatcher: Agent;
  private readonly semaphore: Semaphore;
  private closed = false;

  // WebSocket 状态
  private ws: WebSocket | null = null;
  private readonly handlers = new Map<string, Set<(event: LcuEvent) => void>>();
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect = false;
  private wsOpenPromise: Promise<void> | null = null;

  constructor(options: HttpTransportOptions) {
    this.scheme = options.scheme ?? "https";
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.baseUrl = `${this.scheme}://127.0.0.1:${options.port}`;
    this.semaphore = new Semaphore(options.concurrency ?? DEFAULT_CONCURRENCY);

    this.dispatcher = new Agent({
      connect: { rejectUnauthorized: false },
      pipelining: options.concurrency ?? DEFAULT_CONCURRENCY,
    });
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const raw = await this.requestWithRetry(options);
    return raw.body as T;
  }

  async requestRaw(options: RequestOptions): Promise<RawResponse> {
    return this.requestWithRetry(options);
  }

  private async requestWithRetry(options: RequestOptions): Promise<RawResponse> {
    const maxAttempts = options.method === "GET" ? MAX_RETRIES : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const raw = await this.withSemaphore(() => this.requestOnce(options));
        this.assertSuccess(raw, options);
        logger.debug("lcu request completed", {
          method: options.method,
          path: options.path,
          status: raw.status,
        });
        return raw;
      } catch (error) {
        lastError = error;
        const retriable =
          error instanceof LolError &&
          error.code === "CONNECTION" &&
          options.method === "GET" &&
          attempt < maxAttempts;
        if (!retriable) {
          logger.warn("lcu request failed", {
            method: options.method,
            path: options.path,
            error,
          });
          throw error;
        }
        logger.debug("lcu request failed, retrying", {
          method: options.method,
          path: options.path,
          attempt,
          maxAttempts,
          backoffMs: BASE_BACKOFF_MS * 2 ** (attempt - 1),
        });
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
    throw lastError;
  }

  /** 信号量限流：并发请求数受 Semaphore 限制 */
  private async withSemaphore<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.semaphore.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async requestOnce(options: RequestOptions): Promise<RawResponse> {
    if (this.closed) {
      throw new LolError("CONNECTION", "传输层已关闭");
    }

    const url = this.buildUrl(options.path, options.params);
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`riot:${this.token}`).toString("base64")}`,
      Accept: "application/json",
    };
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(url, {
        method: options.method as string,
        headers,
        ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
        dispatcher: this.dispatcher,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LolError("TIMEOUT", `请求超时（${timeoutMs}ms）: ${options.method} ${options.path}`, {
          cause: error,
        });
      }
      throw new LolError("CONNECTION", `请求失败: ${options.method} ${options.path}`, {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    const contentType = response.headers.get("content-type") ?? "";
    // 二进制资源（图标/原画）直接返回 Buffer；JSON/文本走文本解析
    if (!contentType.includes("json") && !contentType.includes("text")) {
      return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
    }

    const text = await response.text();
    let body: unknown;
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    return { status: response.status, body };
  }

  private buildUrl(path: string, params?: Record<string, string | number>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private assertSuccess(raw: RawResponse, options: RequestOptions): void {
    const status = raw.status;
    const body = (raw.body ?? {}) as { errorCode?: string; httpStatus?: number };

    if (
      status === 404 ||
      body.httpStatus === 404 ||
      body.errorCode === "NOT_FOUND" ||
      body.errorCode === "SUMMONER_NOT_FOUND" ||
      body.errorCode === "GAMES_NOT_FOUND" ||
      body.errorCode === "RANKED_STATS_NOT_FOUND"
    ) {
      throw new LolError("NOT_FOUND", `资源不存在: ${options.method} ${options.path}`, { cause: raw });
    }
    if (status === 429 || body.httpStatus === 429) {
      throw new LolError("RATE_LIMIT", `请求被限流: ${options.method} ${options.path}`, { cause: raw });
    }
    if (status === 401 || status === 403) {
      throw new LolError("AUTH", "LCU 认证失败（token 可能已失效）", { cause: raw });
    }
    // 5xx 视为瞬时服务错误：标记为 CONNECTION 以便 GET 走重试路径
    if (status >= 500) {
      throw new LolError("CONNECTION", `LCU 服务错误 ${status}: ${options.method} ${options.path}`, {
        cause: raw,
      });
    }
    if (status >= 400) {
      throw new LolError("UNKNOWN", `LCU 返回错误状态 ${status}: ${options.method} ${options.path}`, {
        cause: raw,
      });
    }
  }

  // ---------- WebSocket ----------

  subscribe(eventName: string, handler: (event: LcuEvent) => void): () => void {
    let set = this.handlers.get(eventName);
    if (!set) {
      set = new Set();
      this.handlers.set(eventName, set);
    }
    set.add(handler);
    void this.ensureSocket().catch(() => {
      // 连接失败时静默，等待重连或用户主动检查
    });
    return () => {
      const s = this.handlers.get(eventName);
      if (s) {
        s.delete(handler);
        if (s.size === 0) {
          this.handlers.delete(eventName);
        }
      }
    };
  }

  private ensureSocket(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new LolError("CONNECTION", "传输层已关闭"));
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.wsOpenPromise) {
      return this.wsOpenPromise;
    }
    this.shouldReconnect = true;
    this.wsOpenPromise = this.openSocket().finally(() => {
      this.wsOpenPromise = null;
    });
    return this.wsOpenPromise;
  }

  private openSocket(): Promise<void> {
    const wsScheme = this.scheme === "https" ? "wss" : "ws";
    const url = `${wsScheme}://127.0.0.1:${this.baseUrlPort()}/`;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        rejectUnauthorized: false,
        headers: {
          Authorization: `Basic ${Buffer.from(`riot:${this.token}`).toString("base64")}`,
        },
      });
      this.ws = ws;

      const onOpen = () => {
        this.reconnectAttempts = 0;
        for (const eventName of this.handlers.keys()) {
          ws.send(JSON.stringify([5, eventName]));
        }
        resolve();
      };
      const onError = (error: Error) => {
        reject(new LolError("CONNECTION", "WebSocket 连接失败", { cause: error }));
      };
      const onMessage = (data: RawData) => {
        this.handleMessage(data);
      };
      const onClose = () => {
        ws.off("open", onOpen);
        ws.off("error", onError);
        ws.off("message", onMessage);
        ws.off("close", onClose);
        this.ws = null;
        void this.handleDisconnect();
      };

      ws.on("open", onOpen);
      ws.once("error", onError);
      ws.on("message", onMessage);
      ws.on("close", onClose);
    });
  }

  private baseUrlPort(): string {
    return new URL(this.baseUrl).port;
  }

  private handleMessage(data: RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString()) as unknown;
    } catch {
      return;
    }
    if (!Array.isArray(parsed) || parsed.length < 3) {
      return;
    }
    const eventName = parsed[1];
    const payload = parsed[2] as { uri?: string; eventType?: string; data?: unknown } | undefined;
    if (typeof eventName !== "string" || !payload?.uri) {
      return;
    }
    const event: LcuEvent = {
      uri: payload.uri,
      eventType: (payload.eventType ?? "Update") as LcuEventType,
      data: payload.data,
    };
    const handlers = this.handlers.get(eventName);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch {
          // 回调异常不中断其他订阅者
        }
      }
    }
  }

  private handleDisconnect(): void {
    if (!this.shouldReconnect || this.closed) {
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.shouldReconnect = false;
      logger.warn("lcu websocket reconnect attempts exhausted", {
        maxReconnectAttempts: this.maxReconnectAttempts,
      });
      return;
    }
    this.reconnectAttempts += 1;
    const delay = Math.min(500 * 2 ** (this.reconnectAttempts - 1), 8_000);
    logger.warn("lcu websocket disconnected, reconnecting", {
      attempt: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      delayMs: delay,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureSocket().catch(() => {
        // 失败时 close 事件会再次触发 handleDisconnect
      });
    }, delay);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return; // 幂等：重复 close 无副作用
    }
    this.closed = true;
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    await this.dispatcher.close();
    logger.debug("lcu transport closed");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
