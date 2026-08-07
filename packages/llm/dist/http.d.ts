/** 简易超时信号。 */
export declare function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what: string): Promise<T>;
/** 发送 JSON 请求并返回解析后的 body。非 2xx 抛 LlmError。 */
export declare function jsonRequest(provider: string, url: string, init: {
    method?: string;
    headers: Record<string, string>;
    body?: unknown;
    timeoutMs: number;
}): Promise<unknown>;
