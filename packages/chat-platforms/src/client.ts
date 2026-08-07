import type {
  ChatMessage,
  ChatMessageOutbound,
  ChatPlatformAdapter,
  ChatSendResult,
  ChatSource,
} from "./types.js";

/**
 * 多平台客户端：持有若干平台适配器，统一入口收发消息。
 * 上层（如 hoshino-ai 主进程）通过它管理所有已启用平台。
 */
export class ChatPlatformClient {
  readonly #adapters = new Map<string, ChatPlatformAdapter>();
  #onMessage: ((message: ChatMessage) => void | Promise<void>) | null = null;

  /** 注册适配器实例并注入消息回调。同名平台重复注册会覆盖（先断开旧的）。 */
  async add(adapter: ChatPlatformAdapter): Promise<void> {
    await this.#adapters.get(adapter.name)?.disconnect();
    this.#adapters.set(adapter.name, adapter);
    await adapter.connect({
      onMessage: (message) => this.#onMessage?.(message),
    });
  }

  remove(name: string): Promise<void> {
    const adapter = this.#adapters.get(name);
    if (!adapter) return Promise.resolve();
    this.#adapters.delete(name);
    return adapter.disconnect();
  }

  get(name: string): ChatPlatformAdapter | undefined {
    return this.#adapters.get(name);
  }

  list(): readonly ChatPlatformAdapter[] {
    return [...this.#adapters.values()];
  }

  /** 设置统一入站消息处理器（收到任何平台消息都会回调） */
  onMessage(handler: (message: ChatMessage) => void | Promise<void>): void {
    this.#onMessage = handler;
  }

  /** 向指定平台会话发送消息 */
  async send(source: ChatSource, message: ChatMessageOutbound): Promise<ChatSendResult> {
    const adapter = this.#adapters.get(source.platform);
    if (!adapter) {
      throw new Error(`no adapter for platform "${source.platform}"`);
    }
    return adapter.send(source, message);
  }

  /** 断开所有平台 */
  async disconnectAll(): Promise<void> {
    const adapters = [...this.#adapters.values()];
    this.#adapters.clear();
    await Promise.allSettled(adapters.map((adapter) => adapter.disconnect()));
  }
}
