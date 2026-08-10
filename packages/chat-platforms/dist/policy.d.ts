/**
 * 消息响应策略 —— 平台无关的入站消息控制层。
 * 参考 AstrBot platform_settings 设计：白名单/黑名单/唤醒/关键词/限流/表情回应。
 * 上层（如 hoshino-ai）通过 ChatResponsePolicy 控制"哪些消息值得响应"。
 */
/** 表情回应配置：收到可响应消息时随机选一个 emoji 作为"已收到"反馈 */
export interface EmojiReactionConfig {
    /** 是否启用表情回应 */
    enabled: boolean;
    /** 候选 emoji 列表（随机选一个），为空且 enabled 时不回应 */
    emojis: readonly string[];
}
/** 限流配置 */
export interface RateLimitConfig {
    /** 时间窗口（秒） */
    windowSeconds: number;
    /** 窗口内最大消息数 */
    maxMessages: number;
}
/** 消息响应策略（平台无关） */
export interface ChatResponsePolicy {
    /** 是否启用白名单（启用后仅白名单内可对话） */
    enableWhitelist: boolean;
    /** 用户白名单（userId，私聊/群聊均适用） */
    userWhitelist: readonly string[];
    /** 群白名单（chatId，仅群聊适用） */
    groupWhitelist: readonly string[];
    /** 用户黑名单（userId，命中直接忽略） */
    userBlacklist: readonly string[];
    /** 群黑名单（chatId，命中直接忽略） */
    groupBlacklist: readonly string[];
    /** 管理员 userId（豁免白名单） */
    adminUserIds: readonly string[];
    /** 群聊中管理员是否豁免白名单 */
    ignoreAdminInGroup: boolean;
    /** 私聊中管理员是否豁免白名单 */
    ignoreAdminInPrivate: boolean;
    /** 被白名单/黑名单拦截时是否回复提示 */
    replyWhenBlocked: boolean;
    /** 被拦截时的提示语（replyWhenBlocked 时发送） */
    blockedReplyText: string;
    /**
     * 唤醒词（群聊触发）：以任一前缀开头才响应。
     * 群聊中为空时：仅响应 @ 机器人的消息（依赖平台侧推送 @ 事件）。
     */
    groupWakePrefixes: readonly string[];
    /**
     * 群聊未 @ 机器人且未命中唤醒词时是否响应。
     * 默认 false：群聊消息必须 @ 机器人（mentionedBot）或命中唤醒词才响应，
     * 避免应用开启"接收群内所有消息"权限后机器人在群里乱说话。
     */
    respondToUnmentionedGroup: boolean;
    /** 私聊是否需要唤醒词（false = 私聊所有消息都响应） */
    privateNeedsWakePrefix: boolean;
    /** 忽略机器人自己的消息（如需平台推送自身消息时） */
    ignoreBotSelf: boolean;
    /** 忽略 @全体消息 */
    ignoreAtAll: boolean;
    /** 关键词屏蔽：命中任一关键词的消息直接忽略 */
    blockedKeywords: readonly string[];
    /** 限流配置（null = 不限流） */
    rateLimit: RateLimitConfig | null;
    /** 表情回应配置 */
    emojiReaction: EmojiReactionConfig;
}
/** 策略判定结果 */
export type PolicyDecision = {
    action: "respond";
    reaction?: string;
    strippedText?: string;
} | {
    action: "ignore";
    reason: string;
} | {
    action: "blocked";
    replyText: string;
};
/** 默认策略：全放行，不限制 */
export declare function defaultPolicy(): ChatResponsePolicy;
/** 校验策略配置，返回错误信息（null 表示通过） */
export declare function validatePolicy(policy: ChatResponsePolicy): string | null;
