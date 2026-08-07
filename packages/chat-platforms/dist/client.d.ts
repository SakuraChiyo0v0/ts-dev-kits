import type { ChatMessage, ChatMessageOutbound, ChatPlatformAdapter, ChatSendResult, ChatSource } from "./types.js";
/**
 * 多平台客户端：持有若干平台适配器，统一入口收发消息。
 * 上层（如 hoshino-ai 主进程）通过它管理所有已启用平台。
 */
export declare class ChatPlatformClient {
    #private;
    /** 注册适配器实例并注入消息回调。同名平台重复注册会覆盖（先断开旧的）。 */
    add(adapter: ChatPlatformAdapter): Promise<void>;
    remove(name: string): Promise<void>;
    get(name: string): ChatPlatformAdapter | undefined;
    list(): readonly ChatPlatformAdapter[];
    /** 设置统一入站消息处理器（收到任何平台消息都会回调） */
    onMessage(handler: (message: ChatMessage) => void | Promise<void>): void;
    /** 向指定平台会话发送消息 */
    send(source: ChatSource, message: ChatMessageOutbound): Promise<ChatSendResult>;
    /** 断开所有平台 */
    disconnectAll(): Promise<void>;
}
