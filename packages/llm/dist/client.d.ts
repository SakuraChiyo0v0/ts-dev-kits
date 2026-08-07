import type { ChatRequest, ChatResponse, ChatStreamChunk, ImageEditRequest, ImageGenerateRequest, ImageResponse, ImageVariationRequest, LlmClientOptions } from "./types.js";
/** 统一 LLM 客户端。 */
export declare class LLMClient {
    #private;
    constructor(options: LlmClientOptions);
    /** 适配器名称,如 openai / anthropic / gemini / azure。 */
    get provider(): string;
    /** 非流式聊天补全。 */
    chat(request: ChatRequest): Promise<ChatResponse>;
    /** 流式聊天补全,逐块回调。 */
    chatStream(request: ChatRequest, onChunk: (chunk: ChatStreamChunk) => void): Promise<ChatResponse>;
    /** 图片生成。 */
    generateImage(request: ImageGenerateRequest): Promise<ImageResponse>;
    /** 图片编辑。 */
    generateImageEdit(request: ImageEditRequest): Promise<ImageResponse>;
    /** 图片变体。 */
    generateImageVariation(request: ImageVariationRequest): Promise<ImageResponse>;
}
/** 便捷工厂。 */
export declare function createLlmClient(options: LlmClientOptions): LLMClient;
