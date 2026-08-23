/**
 * 系统域 —— 健康检查 / 在线统计 / 当前时间。
 */
import type { VrchatHttpTransport } from "../transport.js";

/** 系统健康状态(需登录,返回 { ok: boolean })。 */
export interface SystemHealth {
  ok: boolean;
  [key: string]: unknown;
}

/** 在线统计(GET /visits 返回纯数字,即当前在线人数)。 */
export type SystemStats = number;

/** 当前时间(GET /time 返回 ISO 8601 字符串)。 */
export type SystemTime = string;

export class SystemApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 健康检查(需登录)。 */
  async health(): Promise<SystemHealth> {
    return this.#transport.request<SystemHealth>({ method: "GET", path: "/health" });
  }

  /** 在线人数(无需登录,返回数字)。 */
  async stats(): Promise<number> {
    return this.#transport.request<number>({ method: "GET", path: "/visits" });
  }

  /** 当前时间(无需登录,返回 ISO 字符串)。 */
  async time(): Promise<string> {
    return this.#transport.request<string>({ method: "GET", path: "/time" });
  }
}
