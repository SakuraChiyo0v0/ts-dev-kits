import { LlmError } from "./errors.js";
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  ImageEditRequest,
  ImageGenerateRequest,
  ImageResponse,
  ImageVariationRequest,
  LlmClientOptions,
  ProviderAdapter,
} from "./types.js";

/** 统一 LLM 客户端。 */
export class LLMClient {
  readonly #adapter: ProviderAdapter;

  constructor(options: LlmClientOptions) {
    this.#adapter = options.adapter;
  }

  /** 适配器名称,如 openai / anthropic / gemini / azure。 */
  get provider(): string {
    return this.#adapter.name;
  }

  /** 非流式聊天补全。 */
  chat(request: ChatRequest): Promise<ChatResponse> {
    return this.#adapter.chat(request);
  }

  /** 流式聊天补全,逐块回调。 */
  async chatStream(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamChunk) => void,
  ): Promise<ChatResponse> {
    return this.#adapter.chatStream(request, onChunk);
  }

  /** 图片生成。 */
  generateImage(request: ImageGenerateRequest): Promise<ImageResponse> {
    if (this.#adapter.generateImage === undefined) {
      throw new LlmError("UNSUPPORTED", `Provider "${this.#adapter.name}" does not support image generation`, {
        provider: this.#adapter.name,
      });
    }
    return this.#adapter.generateImage(request);
  }

  /** 图片编辑。 */
  generateImageEdit(request: ImageEditRequest): Promise<ImageResponse> {
    if (this.#adapter.generateImageEdit === undefined) {
      throw new LlmError("UNSUPPORTED", `Provider "${this.#adapter.name}" does not support image editing`, {
        provider: this.#adapter.name,
      });
    }
    return this.#adapter.generateImageEdit(request);
  }

  /** 图片变体。 */
  generateImageVariation(request: ImageVariationRequest): Promise<ImageResponse> {
    if (this.#adapter.generateImageVariation === undefined) {
      throw new LlmError("UNSUPPORTED", `Provider "${this.#adapter.name}" does not support image variation`, {
        provider: this.#adapter.name,
      });
    }
    return this.#adapter.generateImageVariation(request);
  }
}

/** 便捷工厂。 */
export function createLlmClient(options: LlmClientOptions): LLMClient {
  return new LLMClient(options);
}
