import type { AzureProviderConfig, ProviderAdapter } from "../types.js";
/**
 * Azure OpenAI 适配器。
 * Azure 的请求体与 OpenAI 基本一致,差别在 endpoint(部署名 + api-version 查询参数)
 * 与认证(api-key 头)。通过 openaiAdapter 的 path/query 覆盖即可复用全部逻辑。
 */
export declare function azureAdapter(config: AzureProviderConfig): ProviderAdapter;
