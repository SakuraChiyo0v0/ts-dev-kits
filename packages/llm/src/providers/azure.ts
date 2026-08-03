import type {
  AzureProviderConfig,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  ProviderAdapter,
} from "../types.js";
import { openaiAdapter } from "./openai.js";

/**
 * Azure OpenAI 适配器。
 * Azure 的请求体与 OpenAI 基本一致,差别在 endpoint(部署名 + api-version 查询参数)
 * 与认证(api-key 头)。通过 openaiAdapter 的 path/query 覆盖即可复用全部逻辑。
 */
export function azureAdapter(config: AzureProviderConfig): ProviderAdapter {
  const baseUrl = config.baseUrl.replace(/\/+$/u, "");
  const apiVersion = config.apiVersion ?? "2024-06-01";

  // Azure 的 URL 是 .../openai/deployments/{deployment}/chat/completions?api-version=...
  // 认证用 api-key 头而不是 Bearer,通过 headers 覆盖。
  const inner = openaiAdapter({
    apiKey: config.apiKey,
    baseUrl,
    path: `/openai/deployments/${config.deployment}/chat/completions`,
    query: { "api-version": apiVersion },
    headers: { "api-key": config.apiKey },
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
  });

  return {
    name: "azure",
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const result = await inner.chat(request);
      return { ...result, provider: "azure" };
    },
    async chatStream(
      request: ChatRequest,
      onChunk: (chunk: ChatStreamChunk) => void,
    ): Promise<ChatResponse> {
      const result = await inner.chatStream(request, (chunk) =>
        onChunk({ ...chunk, provider: "azure" }),
      );
      return { ...result, provider: "azure" };
    },
  };
}
