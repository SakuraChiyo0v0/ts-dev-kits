import type { ChatPlatformAdapter, ChatPlatformEntry } from "./types.js";
/**
 * 平台适配器注册表。
 * 参考 hermes PlatformRegistry 模式：注册表 + 工厂，新增平台零改核心。
 */
export declare class ChatPlatformRegistry {
    #private;
    register<TOptions>(entry: ChatPlatformEntry<TOptions>): void;
    get(id: string): ChatPlatformEntry<unknown> | undefined;
    list(): readonly ChatPlatformEntry<unknown>[];
    /** 按 id 创建适配器；未注册时报错 */
    create<TOptions>(id: string, options: TOptions): ChatPlatformAdapter;
}
/** 全局默认注册表（包内预置平台会自动注册到这里） */
export declare const defaultRegistry: ChatPlatformRegistry;
/** 便捷函数：向全局默认注册表注册 */
export declare function registerPlatform<TOptions>(entry: ChatPlatformEntry<TOptions>): void;
