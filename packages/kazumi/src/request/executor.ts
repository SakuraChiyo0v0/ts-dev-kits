import { createLogger } from "@sakurachiyo0v0/logger";
import { KazumiError } from "../errors.js";
import type { AnimeRule } from "../types.js";
import type { PreparedRequest } from "../engine/api-strategy.js";

const logger = createLogger({ namespace: "kazumi" }).child("request");

/** 请求执行器接口(可注入,测试用)。 */
export interface RuleRequestExecutor {
  execute(
    request: PreparedRequest,
    rule: AnimeRule,
    opts?: { timeoutMs?: number },
  ): Promise<string>;
}

/** 默认执行器:undici fetch,注入 UA/Referer。 */
export class DefaultRuleRequestExecutor implements RuleRequestExecutor {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async execute(
    request: PreparedRequest,
    rule: AnimeRule,
    opts?: { timeoutMs?: number },
  ): Promise<string> {
    const headers: Record<string, string> = {
      "user-agent": rule.userAgent || "Mozilla/5.0 (compatible; kazumi-sdk)",
      ...(rule.referer !== "" ? { referer: rule.referer } : {}),
      ...(request.headers ?? {}),
    };
    if (request.bodyType === "json") {
      headers["content-type"] = "application/json";
    } else if (request.bodyType === "form") {
      headers["content-type"] = "application/x-www-form-urlencoded";
    }

    let url = request.url;
    if (request.query && Object.keys(request.query).length > 0) {
      const uri = new URL(url);
      for (const [key, value] of Object.entries(request.query)) {
        uri.searchParams.set(key, value);
      }
      url = uri.toString();
    }

    let body: BodyInit | null = null;
    if (request.bodyType === "json" && request.body !== undefined) {
      body = JSON.stringify(request.body);
    } else if (request.bodyType === "form" && request.body !== undefined) {
      body = new URLSearchParams(
        request.body as Record<string, string>,
      ).toString();
    }

    try {
      const response = await this.fetchImpl(url, {
        method: request.method,
        headers,
        ...(body !== null ? { body } : {}),
        signal: AbortSignal.timeout(opts?.timeoutMs ?? 10_000),
        redirect: "follow",
      });
      if (!response.ok) {
        throw new KazumiError(
          "NETWORK",
          `请求失败 ${request.method} ${url} → HTTP ${response.status}`,
        );
      }
      return await response.text();
    } catch (error) {
      if (error instanceof KazumiError) throw error;
      logger.warn(`请求异常 ${request.method} ${url}`, { error: String(error) });
      throw new KazumiError("NETWORK", `请求异常: ${request.method} ${url}`, error);
    }
  }
}
