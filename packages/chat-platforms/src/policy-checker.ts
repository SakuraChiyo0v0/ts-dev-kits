import type { ChatMessage } from "./types.js";
import type { ChatResponsePolicy, PolicyDecision } from "./policy.js";

/** 滑动窗口限流器（每会话独立） */
class RateLimiter {
  readonly #timestamps = new Map<string, number[]>();
  readonly #windowSeconds: number;
  readonly #maxMessages: number;

  constructor(windowSeconds: number, maxMessages: number) {
    this.#windowSeconds = windowSeconds;
    this.#maxMessages = maxMessages;
  }

  /** 尝试放行一条消息，返回 false 表示超过限流 */
  allow(key: string, nowMs: number = Date.now()): boolean {
    const cutoff = nowMs - this.#windowSeconds * 1000;
    const list = (this.#timestamps.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.#maxMessages) {
      this.#timestamps.set(key, list);
      return false;
    }
    list.push(nowMs);
    this.#timestamps.set(key, list);
    return true;
  }
}

/** 在策略配置变化时可复用（重置限流状态） */
export function createPolicyChecker(policy: ChatResponsePolicy): PolicyChecker {
  return new PolicyChecker(policy);
}

/**
 * 策略执行器：判定一条入站消息是否应响应。
 * 判断顺序：黑名单 → 白名单 → 唤醒词 → 关键词 → 限流 → 表情回应。
 */
export class PolicyChecker {
  readonly #policy: ChatResponsePolicy;
  readonly #rateLimiter: RateLimiter | null;

  constructor(policy: ChatResponsePolicy) {
    this.#policy = policy;
    this.#rateLimiter = policy.rateLimit
      ? new RateLimiter(policy.rateLimit.windowSeconds, policy.rateLimit.maxMessages)
      : null;
  }

  get policy(): ChatResponsePolicy {
    return this.#policy;
  }

  /**
   * 判定消息；返回 respond（可能带表情回应）或 ignore/blocked。
   * 注意：respond 时可能附带 strippedText（去掉唤醒词后的正文）。
   */
  decide(message: ChatMessage): PolicyDecision {
    const source = message.source;
    const userId = source.userId ?? "";
    const chatId = source.chatId;
    const isGroup = source.type === "group";
    const isAdmin = this.#policy.adminUserIds.includes(userId);

    // 1. 黑名单
    if (this.#policy.userBlacklist.includes(userId)) {
      return { action: "ignore", reason: "user-blacklist" };
    }
    if (isGroup && this.#policy.groupBlacklist.includes(chatId)) {
      return { action: "ignore", reason: "group-blacklist" };
    }

    // 2. 白名单（管理员豁免）
    const whitelistEnabled = this.#policy.enableWhitelist;
    const adminExempt = isGroup
      ? this.#policy.ignoreAdminInGroup
      : this.#policy.ignoreAdminInPrivate;
    if (whitelistEnabled && !(isAdmin && adminExempt)) {
      const userOk = this.#policy.userWhitelist.includes(userId);
      const groupOk = isGroup && this.#policy.groupWhitelist.includes(chatId);
      if (!userOk && !groupOk) {
        return this.#policy.replyWhenBlocked
          ? { action: "blocked", replyText: this.#policy.blockedReplyText }
          : { action: "ignore", reason: "whitelist" };
      }
    }

    // 3. 唤醒词（群聊或私聊开启时）
    let text = message.text;
    const isPrivate = !isGroup;
    const needsWake = isGroup
      ? this.#policy.groupWakePrefixes.length > 0
      : this.#policy.privateNeedsWakePrefix;
    let woken = false;
    if (needsWake) {
      const matched = this.#policy.groupWakePrefixes.find((p) => p && text.startsWith(p));
      if (!matched) {
        return { action: "ignore", reason: "not-woken" };
      }
      woken = true;
      // 去掉唤醒词前缀
      text = text.slice(matched.length).trim();
    }
    // 私聊（且未开唤醒要求）视为已唤醒；群聊命中唤醒词或 @ 机器人视为已唤醒
    const isWoken = woken || isPrivate || source.mentionedBot === true;

    // 4. 关键词屏蔽（对去掉唤醒词后的正文判断）
    if (this.#policy.blockedKeywords.some((k) => k && text.includes(k))) {
      return { action: "ignore", reason: "blocked-keyword" };
    }

    // 5. 限流
    if (this.#rateLimiter) {
      const key = `${source.platform}:${chatId}`;
      if (!this.#rateLimiter.allow(key)) {
        return { action: "ignore", reason: "rate-limited" };
      }
    }

    // 6. 表情回应（仅对已唤醒的消息触发，参考 AstrBot is_at_or_wake_command）
    const reaction = isWoken ? this.pickReaction() : undefined;
    return reaction
      ? { action: "respond", reaction, ...(text !== message.text ? { strippedText: text } : {}) }
      : text !== message.text
        ? { action: "respond", strippedText: text }
        : { action: "respond" };
  }

  /** 随机选一个表情（若启用且非空） */
  private pickReaction(): string | undefined {
    const { enabled, emojis } = this.#policy.emojiReaction;
    if (!enabled || emojis.length === 0) return undefined;
    return emojis[Math.floor(Math.random() * emojis.length)];
  }
}
