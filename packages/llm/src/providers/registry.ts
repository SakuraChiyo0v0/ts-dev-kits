import { LlmError } from "../errors.js";
import type { OpenAIProviderConfig, ProviderAdapter } from "../types.js";
import { openaiAdapter } from "./openai.js";

/** OpenAI 兼容提供商注册项。 */
export interface RegistryEntry {
  /** 提供商 id,如 "openai"、"deepseek"。 */
  id: string;
  /** 显示名称。 */
  name: string;
  /** OpenAI 兼容 API 根地址。 */
  baseUrl: string;
  /** 认证头。默认 `authorization: Bearer <apiKey>`。 */
  auth?: "bearer" | { header: string; value: (apiKey: string) => string };
  /** 推荐模型。 */
  defaultModels: string[];
  /** 说明。 */
  note?: string;
}

/** 内置的 OpenAI 兼容提供商注册表。 */
export const openaiCompatibleProviders: readonly RegistryEntry[] = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModels: ["gpt-4o", "gpt-4o-mini"] },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModels: ["deepseek-v4-pro", "deepseek-v4-flash"] },
  { id: "moonshot", name: "Moonshot AI (Kimi)", baseUrl: "https://api.moonshot.cn/v1", defaultModels: ["moonshot-v1-8k", "moonshot-v1-32k"] },
  { id: "zhipu", name: "智谱 AI (BigModel)", baseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModels: ["glm-4-plus", "glm-4-flash"] },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"] },
  { id: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", defaultModels: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"] },
  { id: "fireworks", name: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1", defaultModels: ["accounts/fireworks/models/llama-v3p1-70b-instruct"] },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModels: ["openai/gpt-4o", "anthropic/claude-sonnet-4"] },
  { id: "perplexity", name: "Perplexity", baseUrl: "https://api.perplexity.ai", defaultModels: ["sonar-pro", "sonar"] },
  { id: "mistral", name: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", defaultModels: ["mistral-large-latest", "mistral-small-latest"] },
  { id: "aliyun", name: "阿里云百炼 (DashScope)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModels: ["qwen-plus", "qwen-turbo"] },
  { id: "ollama", name: "Ollama (本地)", baseUrl: "http://localhost:11434/v1", defaultModels: ["llama3.1", "qwen2.5"], note: "本地模型,默认 localhost" },
  { id: "vllm", name: "vLLM (自部署)", baseUrl: "http://localhost:8000/v1", defaultModels: [], note: "自部署 vLLM 服务器" },
  { id: "lmstudio", name: "LM Studio (本地)", baseUrl: "http://localhost:1234/v1", defaultModels: [], note: "本地模型,默认 localhost" },
];

const registryMap = new Map<string, RegistryEntry>(
  openaiCompatibleProviders.map((entry) => [entry.id, entry]),
);

/** 列出所有已注册的提供商 id。 */
export function listProviders(): string[] {
  return [...registryMap.keys()];
}

/** 获取提供商注册项,未注册抛 LlmError。 */
export function getProviderEntry(id: string): RegistryEntry {
  const entry = registryMap.get(id);
  if (entry === undefined) {
    throw new LlmError(
      "CONFIGURATION",
      `Unknown provider "${id}". Known providers: ${listProviders().join(", ")}`,
    );
  }
  return entry;
}

/**
 * 注册自定义提供商(运行时扩展)。
 * 若 id 已存在则覆盖内置项,调用方需自行确认覆盖意图。
 */
export function registerProvider(entry: RegistryEntry): void {
  registryMap.set(entry.id, entry);
}

/** 按提供商 id 创建适配器,返回 OpenAI 兼容适配器。 */
export function createProviderAdapter(
  id: string,
  apiKey: string,
  options?: { baseUrl?: string; timeoutMs?: number },
): ProviderAdapter {
  const entry = getProviderEntry(id);
  const config: OpenAIProviderConfig = {
    apiKey,
    baseUrl: options?.baseUrl ?? entry.baseUrl,
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };
  if (entry.auth !== undefined && entry.auth !== "bearer") {
    const custom = entry.auth;
    config.headers = { [custom.header]: custom.value(apiKey) };
  }
  return openaiAdapter(config);
}
