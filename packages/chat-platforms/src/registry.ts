import type {
  ChatPlatformAdapter,
  ChatPlatformEntry,
  ChatPlatformFactory,
} from "./types.js";
import { ChatPlatformError } from "./errors.js";

/**
 * 平台适配器注册表。
 * 参考 hermes PlatformRegistry 模式：注册表 + 工厂，新增平台零改核心。
 */
export class ChatPlatformRegistry {
  readonly #entries = new Map<string, ChatPlatformEntry<unknown>>();

  register<TOptions>(entry: ChatPlatformEntry<TOptions>): void {
    if (this.#entries.has(entry.id)) {
      throw new ChatPlatformError(
        "CONFIGURATION",
        `platform "${entry.id}" is already registered`,
      );
    }
    this.#entries.set(entry.id, entry as ChatPlatformEntry<unknown>);
  }

  get(id: string): ChatPlatformEntry<unknown> | undefined {
    return this.#entries.get(id);
  }

  list(): readonly ChatPlatformEntry<unknown>[] {
    return [...this.#entries.values()];
  }

  /** 按 id 创建适配器；未注册时报错 */
  create<TOptions>(id: string, options: TOptions): ChatPlatformAdapter {
    const entry = this.#entries.get(id);
    if (!entry) {
      throw new ChatPlatformError(
        "CONFIGURATION",
        `unknown chat platform "${id}"`,
      );
    }
    return (entry.create as ChatPlatformFactory<TOptions>)(options);
  }
}

/** 全局默认注册表（包内预置平台会自动注册到这里） */
export const defaultRegistry = new ChatPlatformRegistry();

/** 便捷函数：向全局默认注册表注册 */
export function registerPlatform<TOptions>(entry: ChatPlatformEntry<TOptions>): void {
  defaultRegistry.register(entry);
}
