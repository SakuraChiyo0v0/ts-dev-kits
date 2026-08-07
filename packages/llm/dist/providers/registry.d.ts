import type { ProviderAdapter } from "../types.js";
/** OpenAI 兼容提供商注册项。 */
export interface RegistryEntry {
    /** 提供商 id,如 "openai"、"deepseek"。 */
    id: string;
    /** 显示名称。 */
    name: string;
    /** OpenAI 兼容 API 根地址。 */
    baseUrl: string;
    /** 认证头。默认 `authorization: Bearer <apiKey>`。 */
    auth?: "bearer" | {
        header: string;
        value: (apiKey: string) => string;
    };
    /** 推荐模型。 */
    defaultModels: string[];
    /** 说明。 */
    note?: string;
}
/** 内置的 OpenAI 兼容提供商注册表。 */
export declare const openaiCompatibleProviders: readonly RegistryEntry[];
/** 列出所有已注册的提供商 id。 */
export declare function listProviders(): string[];
/** 获取提供商注册项,未注册抛 LlmError。 */
export declare function getProviderEntry(id: string): RegistryEntry;
/**
 * 注册自定义提供商(运行时扩展)。
 * 若 id 已存在则覆盖内置项,调用方需自行确认覆盖意图。
 */
export declare function registerProvider(entry: RegistryEntry): void;
/** 按提供商 id 创建适配器,返回 OpenAI 兼容适配器。 */
export declare function createProviderAdapter(id: string, apiKey: string, options?: {
    baseUrl?: string;
    timeoutMs?: number;
}): ProviderAdapter;
