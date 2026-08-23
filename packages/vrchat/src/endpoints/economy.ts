/**
 * 经济域 —— 余额 / 交易记录。
 */
import type { VrchatHttpTransport } from "../transport.js";

/** 账户余额。 */
export interface Balance {
  balance: number;
  [key: string]: unknown;
}

/** 交易记录。 */
export interface Transaction {
  id: string;
  status: "active" | "failed" | "succeeded" | "cancelled";
  [key: string]: unknown;
}

export class EconomyApi {
  readonly #transport: VrchatHttpTransport;

  constructor(transport: VrchatHttpTransport) {
    this.#transport = transport;
  }

  /** 获取用户余额。 */
  async getBalance(userId: string): Promise<Balance> {
    return this.#transport.request<Balance>({
      method: "GET",
      path: `/user/${encodeURIComponent(userId)}/balance`,
    });
  }

  /** 获取用户交易记录。 */
  async getTransactions(
    userId: string,
    options: { n?: number; offset?: number } = {},
  ): Promise<Transaction[]> {
    return this.#transport.request<Transaction[]>({
      method: "GET",
      path: `/user/${encodeURIComponent(userId)}/economy/transactions`,
      params: {
        ...(options.n !== undefined ? { n: options.n } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
      },
    });
  }
}
