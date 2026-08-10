/**
 * 卡片命令协议 —— 借鉴 Reasonix internal/bot/render.go 的"卡片即命令"设计。
 *
 * 核心思想：卡片按钮的 value 编码"要执行的命令 + 路由上下文"（command/chat_type/user_id）。
 * 用户点击按钮 → card.action.trigger 回调 → SDK 解码出 command，重新作为入站消息处理。
 * 这样按钮点击复用整套策略/会话/命令链路，而不是为卡片单独写一套逻辑。
 */
import type { ChatCard, ChatCardButton, ChatMessageType } from "./types.js";
/** 卡片按钮 value 中编码的命令字段 */
export interface CardCommandValue {
    /** 要执行的命令文本，如 "/approve abc123"（当作一条用户消息处理） */
    command: string;
    /** 会话类型：按钮所在的群/私聊 */
    chat_type?: ChatMessageType;
    /** 点击者 userId（用于权限门控） */
    user_id?: string;
    /** 兼容 Record<string, unknown> 赋值（ChatCardButton.value 类型） */
    [key: string]: unknown;
}
/**
 * 构造卡片按钮 value（编码命令 + 路由上下文）。
 * 用法：按钮点击后 value 会原样回到 onCardAction，用 parseCardCommandValue 解码。
 */
export declare function cardCommandValue(command: string, opts?: {
    chatType?: ChatMessageType;
    userId?: string;
}): CardCommandValue;
/**
 * 解码卡片回调的 value。
 * 兼容三种形态：
 *  1. 本协议编码的对象 { command, chat_type, user_id }
 *  2. 纯字符串（旧式：直接当文本）
 *  3. 其他对象（无 command 字段 → 返回 null，调用方按普通文本处理）
 */
export declare function parseCardCommandValue(value: Record<string, unknown> | string | undefined): CardCommandValue | null;
/**
 * 结构化卡片构造 —— 参考 Reasonix approvalCard/askCard。
 * 一个 markdown 正文 + 一行按钮的简单交互卡片。
 */
export declare function actionCard(opts: {
    /** 卡片标题 */
    header?: string;
    /** 卡片正文（markdown） */
    markdown?: string;
    /** 按钮行 */
    buttons?: Array<{
        text: string;
        type?: "default" | "primary" | "danger";
    } & ({
        command: string;
    } | {
        value: Record<string, unknown>;
    })>;
    /** 按钮编码命令时的默认路由上下文 */
    chatType?: ChatMessageType;
    userId?: string;
}): ChatCard;
export type { ChatCardButton, ChatCard };
