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
