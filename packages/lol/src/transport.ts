/**
 * 传输层接口。REST 请求 + WebSocket 事件订阅，与具体实现（LCU / mock / SGP）解耦，
 * 便于测试注入与未来替换。
 */

import type { LcuEvent } from "./types.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  /** URL query 参数 */
  params?: Record<string, string | number>;
  /** JSON 请求体 */
  json?: unknown;
  /** 请求超时（毫秒），缺省用客户端默认值 */
  timeoutMs?: number;
}

export interface RawResponse {
  status: number;
  /** JSON 解析后的 body；无 body 时为 undefined */
  body: unknown;
}

export interface LcuTransport {
  /** 发送请求并返回解析后的 JSON（由调用方断言类型） */
  request<T>(options: RequestOptions): Promise<T>;
  /** 发送请求并返回原始响应（状态码 + body），不抛业务错误 */
  requestRaw(options: RequestOptions): Promise<RawResponse>;
  /** 订阅 LCU WebSocket 事件；返回取消订阅函数 */
  subscribe(eventName: string, handler: (event: LcuEvent) => void): () => void;
  /** 关闭传输层（HTTP 会话与 WebSocket） */
  close(): Promise<void>;
}
