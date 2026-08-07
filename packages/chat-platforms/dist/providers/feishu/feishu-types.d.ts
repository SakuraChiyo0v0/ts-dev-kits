import type { ChatPlatformErrorCode } from "../../errors.js";
/** 飞书应用配置 */
export interface FeishuConfig {
    /** 应用 App ID，如 cli_xxx */
    appId: string;
    /** 应用 App Secret */
    appSecret: string;
    /** 事件接收方式：长连接（默认）或 webhook 回调 */
    transport: "websocket" | "webhook";
    /**
     * webhook 模式必填：事件订阅的回调地址（含验签配置）。
     * verificationToken / encryptKey 用于飞书回调验签与解密。
     */
    verificationToken?: string;
    encryptKey?: string;
    /** 私聊是否也响应（默认 true）；false 时只处理群聊 @ 机器人 */
    enablePrivateChat?: boolean;
}
/** 归一化飞书错误码 */
export declare function feishuErrorCode(code: number): ChatPlatformErrorCode;
/** 校验配置，返回错误信息（null 表示通过） */
export declare function validateFeishuConfig(config: unknown): string | null;
/**
 * 飞书表情回应支持的表情 key（英文枚举，非 Unicode emoji）。
 * 完整 182 个见官方文档：https://open.feishu.cn/document/server-docs/im-v1/message-reaction/emojis-introduce
 * 这里收录常用子集；传不在此列表的值飞书 API 会返回 400/231001。
 */
export declare const FEISHU_EMOJI_KEYS: readonly string[];
/** 校验表情 key 是否合法（飞书支持）；返回错误信息（null 表示合法） */
export declare function validateFeishuEmoji(emoji: string): string | null;
