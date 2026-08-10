import type { ChatCardAction, ChatMessage, ChatMessageOutbound, ChatPlatformAdapter, ChatSendResult, ChatSource } from "./types.js";
import type { ChatResponsePolicy } from "./policy.js";
/**
 * 多平台客户端：持有若干平台适配器，统一入口收发消息。
 * 上层（如 hoshino-ai 主进程）通过它管理所有已启用平台。
 * 可配置响应策略：收到消息先过策略（白名单/黑名单/唤醒/关键词/限流/表情），再决定是否回调。
 */
export declare class ChatPlatformClient {
    #private;
    /**
     * 注册适配器实例并注入消息回调。
     * policy 为可选：提供后，入站消息先过策略再决定是否回调。
     */
    add(adapter: ChatPlatformAdapter, policy?: ChatResponsePolicy): Promise<void>;
    /** 更新某平台的响应策略（不改动连接） */
    setPolicy(name: string, policy: ChatResponsePolicy | null): void;
    remove(name: string): Promise<void>;
    get(name: string): ChatPlatformAdapter | undefined;
    list(): readonly ChatPlatformAdapter[];
    /** 设置统一入站消息处理器（收到任何平台消息都会回调） */
    onMessage(handler: (message: ChatMessage) => void | Promise<void>): void;
    /** 设置被策略拦截（blocked）时的处理器（可发送提示回复） */
    onBlocked(handler: (message: ChatMessage, replyText: string) => void | Promise<void>): void;
    /** 设置卡片按钮/菜单点击处理器 */
    onCardAction(handler: (action: ChatCardAction) => void | Promise<void>): void;
    /** 向指定平台会话发送消息 */
    send(source: ChatSource, message: ChatMessageOutbound): Promise<ChatSendResult>;
    /** 断开所有平台 */
    disconnectAll(): Promise<void>;
}
