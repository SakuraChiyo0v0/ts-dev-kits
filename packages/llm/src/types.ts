/** OpenAI 兼容的核心消息与请求类型。 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** 多模态内容块。 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

/** 一条聊天消息,OpenAI 兼容形态。 */
export interface ChatMessage {
  role: ChatRole;
  /** 正文。assistant 带 tool_calls 时可为空。 */
  content?: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

/** 工具调用(assistant 消息里的请求)。 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON 字符串
  };
}

/** 工具定义。 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

/** 统一请求(OpenAI 形态)。 */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  /** 附加的原始请求字段,透传给提供商。 */
  extra?: Record<string, unknown>;
}

/** 统一响应(OpenAI 形态)。 */
export interface ChatResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finishReason: string | null;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 提供商名称。 */
  provider: string;
  /** 提供商原始响应。 */
  raw: unknown;
}

/** 统一流式块(OpenAI 形态)。 */
export interface ChatStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finishReason: string | null;
  }>;
  provider: string;
  raw?: unknown;
}

/** 提供商配置基类。 */
export interface ProviderConfig {
  /** 超时毫秒。 */
  timeoutMs?: number;
}

/** OpenAI / OpenAI 兼容端点配置。 */
export interface OpenAIProviderConfig extends ProviderConfig {
  apiKey: string;
  baseUrl?: string; // 默认 https://api.openai.com/v1
  /** 请求路径,默认 /chat/completions。Azure 场景会覆盖。 */
  path?: string;
  /** 附加查询参数。 */
  query?: Record<string, string>;
  /** 附加请求头。Azure 用它覆盖认证方式。 */
  headers?: Record<string, string>;
}

/** Azure OpenAI 配置。 */
export interface AzureProviderConfig extends ProviderConfig {
  apiKey: string;
  /** 如 https://my-resource.openai.azure.com/openai/deployments/ */
  baseUrl: string;
  /** 部署名(相当于 model 的部署名)。 */
  deployment: string;
  /** API 版本,默认 2024-06-01。 */
  apiVersion?: string;
}

/** Anthropic 配置。 */
export interface AnthropicProviderConfig extends ProviderConfig {
  apiKey: string;
  baseUrl?: string; // 默认 https://api.anthropic.com/v1
}

/** Google Gemini 配置。 */
export interface GeminiProviderConfig extends ProviderConfig {
  apiKey: string;
  baseUrl?: string; // 默认 https://generativelanguage.googleapis.com/v1beta
}

/** 图片生成请求。 */
export interface ImageGenerateRequest {
  model?: string;
  prompt: string;
  /** 输出尺寸,如 `"1024x1024"`。 */
  size?: string;
  /** 生成数量,默认 1。 */
  n?: number;
  /** 输出格式,如 `"b64_json"` 或 `"url"`,默认 `"b64_json"`。 */
  responseFormat?: "b64_json" | "url";
  quality?: "standard" | "hd";
  style?: "vivid" | "natural";
}

/** 图片编辑请求(基于原图修改)。 */
export interface ImageEditRequest {
  model?: string;
  /** 编辑指令。 */
  prompt: string;
  /** 原图(base64 或 data URL)。 */
  image: string;
  /** 可选的掩码图(base64 或 data URL)。 */
  mask?: string;
  size?: string;
  n?: number;
  responseFormat?: "b64_json" | "url";
}

/** 图片变体请求(基于原图生成变体)。 */
export interface ImageVariationRequest {
  model?: string;
  /** 原图(base64 或 data URL)。 */
  image: string;
  size?: string;
  n?: number;
  responseFormat?: "b64_json" | "url";
}

/** 单张生成结果。 */
export interface GeneratedImage {
  /** base64 编码的图片(当 responseFormat 为 b64_json 时)。 */
  b64Json?: string;
  /** 图片 URL(当 responseFormat 为 url 时)。 */
  url?: string;
  /** 修改后的提示词(部分提供商返回)。 */
  revisedPrompt?: string;
}

/** 统一的图片生成响应。 */
export interface ImageResponse {
  images: GeneratedImage[];
  provider: string;
  raw: unknown;
}

/** 适配器接口:每个提供商实现一次。 */
export interface ProviderAdapter {
  readonly name: string;
  /** 将统一请求转换为提供商请求并发送,返回统一响应。 */
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** 流式发送,逐块回调统一流式块。 */
  chatStream(request: ChatRequest, onChunk: (chunk: ChatStreamChunk) => void): Promise<ChatResponse>;
  /** 图片生成。未支持的适配器抛 LlmError(UNSUPPORTED)。 */
  generateImage?(request: ImageGenerateRequest): Promise<ImageResponse>;
  /** 图片编辑。未支持的适配器抛 LlmError(UNSUPPORTED)。 */
  generateImageEdit?(request: ImageEditRequest): Promise<ImageResponse>;
  /** 图片变体。未支持的适配器抛 LlmError(UNSUPPORTED)。 */
  generateImageVariation?(request: ImageVariationRequest): Promise<ImageResponse>;
}

/** 客户端配置。 */
export interface LlmClientOptions {
  /** 使用的适配器。 */
  adapter: ProviderAdapter;
}

/** 供 LLM 调用的工具（Skill / MCP / 自定义工具统一实现此接口）。 */
export interface LlmTool {
  /** 工具名（唯一，用于 LLM 选择） */
  name: string;
  /** 工具说明（LLM 根据它决定何时调用） */
  description: string;
  /** JSON Schema 参数定义 */
  parameters: Record<string, unknown>;
  /** 执行工具，返回给 LLM 的结果文本 */
  execute(args: Record<string, unknown>): Promise<string>;
}
