import { type Server } from "node:http";
import type { ProviderAdapter } from "./types.js";
export interface LlmProxyOptions {
    adapter: ProviderAdapter;
    /** 默认模型,请求未指定时使用。 */
    defaultModel?: string;
}
/** 轻量 OpenAI 兼容代理:暴露 /v1/chat/completions,内部用 LLMClient 路由。 */
export declare function createLlmProxy(options: LlmProxyOptions): Server;
