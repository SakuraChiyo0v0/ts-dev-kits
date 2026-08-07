import { describe, expect, it } from "vitest";
import { feishuProvider, validateFeishuConfig, validateFeishuEmoji, FEISHU_EMOJI_KEYS } from "../src/index.js";

/** 构造一个飞书 im.message.receive_v1 事件 payload（与 SDK 类型对齐） */
function messageEvent(overrides: {
  chatType?: string;
  msgType?: string;
  content?: string;
  chatId?: string;
  messageId?: string;
} = {}) {
  const {
    chatType = "p2p",
    msgType = "text",
    content = JSON.stringify({ text: "你好，Hoshino" }),
    chatId = "oc_123",
    messageId = "om_123",
  } = overrides;
  return {
    sender: {
      sender_id: { open_id: "ou_123", user_id: "u_123", union_id: "on_123" },
      sender_type: "user",
    },
    message: {
      message_id: messageId,
      create_time: "1700000000000",
      chat_id: chatId,
      chat_type: chatType,
      message_type: msgType,
      content,
    },
  };
}

describe("validateFeishuConfig", () => {
  it("rejects missing credentials", () => {
    expect(validateFeishuConfig({})).toMatch(/appId/);
    expect(validateFeishuConfig({ appId: "cli_x" })).toMatch(/appSecret/);
  });

  it("accepts valid websocket config", () => {
    expect(
      validateFeishuConfig({ appId: "cli_x", appSecret: "secret" }),
    ).toBeNull();
  });

  it("webhook requires verification token or encrypt key", () => {
    expect(
      validateFeishuConfig({ appId: "cli_x", appSecret: "s", transport: "webhook" }),
    ).toMatch(/verificationToken|encryptKey/);
    expect(
      validateFeishuConfig({
        appId: "cli_x",
        appSecret: "s",
        transport: "webhook",
        encryptKey: "key",
      }),
    ).toBeNull();
  });
});

describe("feishuProvider", () => {
  it("webhook mode: answers url_verification challenge", async () => {
    const adapter = feishuProvider({
      appId: "cli_x",
      appSecret: "s",
      transport: "webhook",
      encryptKey: "key",
    });
    const res = await adapter.handleWebhook!(
      JSON.stringify({ type: "url_verification", challenge: "abc123" }),
    );
    expect(res).toEqual({ challenge: "abc123", ok: true });
  });

  it("webhook mode: routes im.message.receive_v1 to onMessage", async () => {
    const adapter = feishuProvider({
      appId: "cli_x",
      appSecret: "s",
      transport: "webhook",
      encryptKey: "key",
    });
    const received: unknown[] = [];
    await adapter.connect({ onMessage: async (m) => { received.push(m) } });

    const body = JSON.stringify({
      schema: "2.0",
      header: { event_type: "im.message.receive_v1" },
      event: messageEvent(),
    });
    const res = await adapter.handleWebhook!(body);
    expect(res.ok).toBe(true);
    expect(received).toHaveLength(1);
    const msg = received[0] as { text: string; source: { platform: string; chatId: string; type: string } };
    expect(msg.text).toBe("你好，Hoshino");
    expect(msg.source.platform).toBe("feishu");
    expect(msg.source.chatId).toBe("oc_123");
    expect(msg.source.type).toBe("private");
    await adapter.disconnect();
  });

  it("ignores non-text messages", async () => {
    const adapter = feishuProvider({
      appId: "cli_x",
      appSecret: "s",
      transport: "webhook",
      encryptKey: "key",
    });
    const received: unknown[] = [];
    await adapter.connect({ onMessage: async (m) => { received.push(m) } });
    const body = JSON.stringify({
      schema: "2.0",
      header: { event_type: "im.message.receive_v1" },
      event: messageEvent({
        msgType: "image",
        content: JSON.stringify({ image_key: "img_v2_x" }),
      }),
    });
    await adapter.handleWebhook!(body);
    expect(received).toHaveLength(0);
    await adapter.disconnect();
  });

  it("maps group chat to group source", async () => {
    const adapter = feishuProvider({
      appId: "cli_x",
      appSecret: "s",
      transport: "webhook",
      encryptKey: "key",
    });
    const received: unknown[] = [];
    await adapter.connect({ onMessage: async (m) => { received.push(m) } });
    const body = JSON.stringify({
      schema: "2.0",
      header: { event_type: "im.message.receive_v1" },
      event: messageEvent({ chatType: "group", chatId: "oc_group" }),
    });
    await adapter.handleWebhook!(body);
    const msg = received[0] as { source: { type: string; chatId: string } };
    expect(msg.source.type).toBe("group");
    expect(msg.source.chatId).toBe("oc_group");
    await adapter.disconnect();
  });
});

describe("validateFeishuEmoji", () => {
  it("accepts official English keys", () => {
    for (const key of ["THUMBSUP", "OK", "Typing", "LGTM", "REDPACKET"]) {
      expect(validateFeishuEmoji(key)).toBeNull();
    }
  });

  it("rejects Unicode emoji", () => {
    expect(validateFeishuEmoji("👍")).toMatch(/飞书表情 key/);
    expect(validateFeishuEmoji("🤔")).toMatch(/飞书表情 key/);
  });

  it("rejects unknown keys", () => {
    expect(validateFeishuEmoji("NOT_A_REAL_EMOJI")).toMatch(/不在已知/);
  });

  it("FEISHU_EMOJI_KEYS contains the common set", () => {
    expect(FEISHU_EMOJI_KEYS).toContain("Typing");
    expect(FEISHU_EMOJI_KEYS).toContain("THUMBSUP");
  });
});
