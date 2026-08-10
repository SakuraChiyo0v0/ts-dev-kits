import type {
  ChatCardAction,
  ChatMessage,
  ChatMessageOutbound,
  ChatPlatformAdapter,
  ChatSendResult,
  ChatSource,
} from "./types.js";
import type { ChatResponsePolicy } from "./policy.js";
import { createPolicyChecker, type PolicyChecker } from "./policy-checker.js";

/**
 * 多平台客户端：持有若干平台适配器，统一入口收发消息。
 * 上层（如 hoshino-ai 主进程）通过它管理所有已启用平台。
 * 可配置响应策略：收到消息先过策略（白名单/黑名单/唤醒/关键词/限流/表情），再决定是否回调。
 */
export class ChatPlatformClient {
  readonly #adapters = new Map<string, ChatPlatformAdapter>();
  readonly #checkers = new Map<string, PolicyChecker>();
  #onMessage: ((message: ChatMessage) => void | Promise<void>) | null = null;
  #onBlocked: ((message: ChatMessage, replyText: string) => void | Promise<void>) | null = null;
  #onCardAction: ((action: ChatCardAction) => void | Promise<void>) | null = null;

  /**
   * 注册适配器实例并注入消息回调。
   * policy 为可选：提供后，入站消息先过策略再决定是否回调。
   */
  async add(adapter: ChatPlatformAdapter, policy?: ChatResponsePolicy): Promise<void> {
    await this.#adapters.get(adapter.name)?.disconnect();
    this.#adapters.set(adapter.name, adapter);
    this.#checkers.set(adapter.name, policy ? createPolicyChecker(policy) : null!);

    await adapter.connect({
      onMessage: (message) => this.#route(adapter.name, message),
      onCardAction: (action) => this.#onCardAction?.(action),
    });
  }

  /** 更新某平台的响应策略（不改动连接） */
  setPolicy(name: string, policy: ChatResponsePolicy | null): void {
    if (policy) {
      this.#checkers.set(name, createPolicyChecker(policy));
    } else {
      this.#checkers.delete(name);
    }
  }

  remove(name: string): Promise<void> {
    const adapter = this.#adapters.get(name);
    if (!adapter) return Promise.resolve();
    this.#adapters.delete(name);
    this.#checkers.delete(name);
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

  /** 设置被策略拦截（blocked）时的处理器（可发送提示回复） */
  onBlocked(handler: (message: ChatMessage, replyText: string) => void | Promise<void>): void {
    this.#onBlocked = handler;
  }

  /** 设置卡片按钮/菜单点击处理器 */
  onCardAction(handler: (action: ChatCardAction) => void | Promise<void>): void {
    this.#onCardAction = handler;
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
    this.#checkers.clear();
    await Promise.allSettled(adapters.map((adapter) => adapter.disconnect()));
  }

  /** 入站消息路由：过策略 → 回调 or 拦截 */
  async #route(platform: string, message: ChatMessage): Promise<void> {
    const checker = this.#checkers.get(platform);
    if (checker) {
      const decision = checker.decide(message);
      if (decision.action === "ignore") {
        return;
      }
      if (decision.action === "blocked") {
        await this.#onBlocked?.(message, decision.replyText);
        return;
      }
      // respond：若去掉了唤醒词，把处理后的文本回填
      if (decision.strippedText !== undefined) {
        message.text = decision.strippedText;
      }
      // 表情回应：若适配器支持 react 且策略选出了表情
      if (decision.reaction) {
        await this.#adapters
          .get(platform)
          ?.react?.(message, decision.reaction)
          .catch((err) => {
            console.error(`[chat-platforms] 表情回应失败(${platform}):`, err instanceof Error ? err.message : err);
          });
      }
    }
    await this.#onMessage?.(message);
  }
}
