import type { ChatMessage } from "./types.js";
import type { ChatResponsePolicy, PolicyDecision } from "./policy.js";
/** 在策略配置变化时可复用（重置限流状态） */
export declare function createPolicyChecker(policy: ChatResponsePolicy): PolicyChecker;
/**
 * 策略执行器：判定一条入站消息是否应响应。
 * 判断顺序：黑名单 → 白名单 → 唤醒词 → 关键词 → 限流 → 表情回应。
 */
export declare class PolicyChecker {
    #private;
    constructor(policy: ChatResponsePolicy);
    get policy(): ChatResponsePolicy;
    /**
     * 判定消息；返回 respond（可能带表情回应）或 ignore/blocked。
     * 注意：respond 时可能附带 strippedText（去掉唤醒词后的正文）。
     */
    decide(message: ChatMessage): PolicyDecision;
    /** 随机选一个表情（若启用且非空） */
    private pickReaction;
}
