import { describe, expect, it } from "vitest";
import {
  ChatPlatformClient,
  defaultPolicy,
  PolicyChecker,
  createPolicyChecker,
  validatePolicy,
  type ChatMessage,
  type ChatPlatformAdapter,
  type ChatResponsePolicy,
} from "../src/index.js";

function msg(overrides: Partial<ChatMessage> & { userId?: string; chatId?: string; type?: "private" | "group"; text?: string } = {}): ChatMessage {
  return {
    messageId: overrides.messageId ?? "m-1",
    source: {
      platform: "feishu",
      chatId: overrides.chatId ?? "chat-1",
      type: overrides.type ?? "private",
      ...(overrides.userId !== undefined ? { userId: overrides.userId } : {}),
    },
    text: overrides.text ?? "你好",
  };
}

function policy(overrides: Partial<ChatResponsePolicy> = {}): ChatResponsePolicy {
  return { ...defaultPolicy(), ...overrides };
}

describe("PolicyChecker", () => {
  it("default policy responds to everything", () => {
    const checker = new PolicyChecker(defaultPolicy());
    expect(checker.decide(msg()).action).toBe("respond");
  });

  it("user blacklist ignores", () => {
    const checker = new PolicyChecker(policy({ userBlacklist: ["u_bad"] }));
    expect(checker.decide(msg({ userId: "u_bad" })).action).toBe("ignore");
    expect(checker.decide(msg({ userId: "u_ok" })).action).toBe("respond");
  });

  it("group blacklist ignores group messages", () => {
    const checker = new PolicyChecker(policy({ groupBlacklist: ["g_bad"] }));
    expect(checker.decide(msg({ type: "group", chatId: "g_bad" })).action).toBe("ignore");
    expect(checker.decide(msg({ type: "group", chatId: "g_ok" })).action).toBe("respond");
  });

  it("whitelist: only whitelisted users/groups respond", () => {
    const checker = new PolicyChecker(
      policy({ enableWhitelist: true, userWhitelist: ["u_ok"], groupWhitelist: ["g_ok"] }),
    );
    expect(checker.decide(msg({ userId: "u_ok" })).action).toBe("respond");
    expect(checker.decide(msg({ userId: "u_no" })).action).toBe("ignore");
    // 群聊：群白名单命中即可（即使发送者不在用户白名单）
    expect(checker.decide(msg({ type: "group", chatId: "g_ok", userId: "u_no" })).action).toBe("respond");
    // 群聊：发送者在用户白名单（全局适用），即使群不在群白名单也放行
    expect(checker.decide(msg({ type: "group", chatId: "g_no", userId: "u_ok" })).action).toBe("respond");
    // 群聊：两者都不在白名单 → 拦截
    expect(checker.decide(msg({ type: "group", chatId: "g_no", userId: "u_no" })).action).toBe("ignore");
  });

  it("whitelist: admin exempt", () => {
    const checker = new PolicyChecker(
      policy({
        enableWhitelist: true,
        userWhitelist: ["u_ok"],
        adminUserIds: ["u_admin"],
        ignoreAdminInGroup: true,
        ignoreAdminInPrivate: true,
      }),
    );
    expect(checker.decide(msg({ userId: "u_admin" })).action).toBe("respond");
  });

  it("whitelist blocked with replyWhenBlocked", () => {
    const checker = new PolicyChecker(
      policy({
        enableWhitelist: true,
        userWhitelist: ["u_ok"],
        replyWhenBlocked: true,
        blockedReplyText: "没有权限",
      }),
    );
    const decision = checker.decide(msg({ userId: "u_no" }));
    expect(decision.action).toBe("blocked");
    if (decision.action === "blocked") {
      expect(decision.replyText).toBe("没有权限");
    }
  });

  it("group wake prefix strips prefix", () => {
    const checker = new PolicyChecker(policy({ groupWakePrefixes: ["/h"] }));
    const decision = checker.decide(msg({ type: "group", text: "/h你好" }));
    expect(decision.action).toBe("respond");
    if (decision.action === "respond") {
      expect(decision.strippedText).toBe("你好");
    }
    expect(checker.decide(msg({ type: "group", text: "不带唤醒词" })).action).toBe("ignore");
  });

  it("blocked keywords ignore", () => {
    const checker = new PolicyChecker(policy({ blockedKeywords: ["敏感词"] }));
    expect(checker.decide(msg({ text: "这里有个敏感词" })).action).toBe("ignore");
    expect(checker.decide(msg({ text: "正常内容" })).action).toBe("respond");
  });

  it("rate limit: over limit ignored", () => {
    const checker = new PolicyChecker(
      policy({ rateLimit: { windowSeconds: 60, maxMessages: 2 } }),
    );
    expect(checker.decide(msg({ messageId: "1" })).action).toBe("respond");
    expect(checker.decide(msg({ messageId: "2" })).action).toBe("respond");
    expect(checker.decide(msg({ messageId: "3" })).action).toBe("ignore");
  });

  it("emoji reaction picked when enabled", () => {
    const checker = new PolicyChecker(
      policy({ emojiReaction: { enabled: true, emojis: ["👍"] } }),
    );
    const decision = checker.decide(msg());
    expect(decision.action).toBe("respond");
    if (decision.action === "respond") {
      expect(decision.reaction).toBe("👍");
    }
  });
});

describe("validatePolicy", () => {
  it("rejects whitelist enabled with empty lists", () => {
    expect(validatePolicy(policy({ enableWhitelist: true }))).toMatch(/白名单/);
  });

  it("rejects invalid rate limit", () => {
    expect(
      validatePolicy(policy({ rateLimit: { windowSeconds: 0, maxMessages: 5 } })),
    ).toMatch(/限流/);
  });

  it("accepts valid policy", () => {
    expect(validatePolicy(policy({ enableWhitelist: true, userWhitelist: ["u"] }))).toBeNull();
  });
});

describe("ChatPlatformClient with policy", () => {
  /** 适配器在 connect 时保存 onMessage，测试可直接触发入站消息 */
  function fakeAdapter() {
    let onMessage: ((m: ChatMessage) => void | Promise<void>) | null = null;
    const adapter: ChatPlatformAdapter = {
      name: "fake",
      capabilities: { supportsRichText: false, supportsImages: false, splitsLongMessages: false },
      connect: async ({ onMessage: handler }) => {
        onMessage = handler;
      },
      disconnect: async () => undefined,
      send: async () => ({ platform: "fake", messageId: "x", ok: true }),
    };
    return { adapter, trigger: (m: ChatMessage) => { void onMessage?.(m) } };
  }

  it("routes only whitelisted messages to onMessage", async () => {
    const client = new ChatPlatformClient();
    const { adapter, trigger } = fakeAdapter();
    const received: ChatMessage[] = [];
    client.onMessage(async (m) => { received.push(m) });

    await client.add(adapter, policy({ enableWhitelist: true, userWhitelist: ["u_ok"] }));

    await trigger(msg({ userId: "u_ok", messageId: "1" }));
    await trigger(msg({ userId: "u_no", messageId: "2" }));

    expect(received).toHaveLength(1);
    expect(received[0]?.source.userId).toBe("u_ok");
    await client.disconnectAll();
  });

  it("onBlocked fires when policy blocks with replyWhenBlocked", async () => {
    const client = new ChatPlatformClient();
    const { adapter, trigger } = fakeAdapter();
    const blocked: { message: ChatMessage; reply: string }[] = [];
    client.onBlocked(async (m, reply) => { blocked.push({ message: m, reply }) });

    await client.add(
      adapter,
      policy({
        enableWhitelist: true,
        userWhitelist: ["u_ok"],
        replyWhenBlocked: true,
        blockedReplyText: "无权限",
      }),
    );

    await trigger(msg({ userId: "u_no", messageId: "3" }));

    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.reply).toBe("无权限");
    await client.disconnectAll();
  });

  it("wake prefix strips text before onMessage", async () => {
    const client = new ChatPlatformClient();
    const { adapter, trigger } = fakeAdapter();
    const received: ChatMessage[] = [];
    client.onMessage(async (m) => { received.push(m) });

    await client.add(adapter, policy({ groupWakePrefixes: ["/h"] }));

    await trigger(msg({ type: "group", text: "/h你好", messageId: "4" }));
    expect(received[0]?.text).toBe("你好");
    await client.disconnectAll();
  });
});
