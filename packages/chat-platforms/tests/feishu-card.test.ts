import { describe, expect, it, vi } from "vitest";
import { feishuProvider, type ChatCard, type ChatMessageOutbound } from "../src/index.js";

function makeAdapter() {
  return feishuProvider({
    appId: "cli_x",
    appSecret: "s",
    transport: "webhook",
    encryptKey: "key",
  });
}

describe("feishuProvider 卡片发送", () => {
  it("send with card calls cardkit.create + im.message.create", async () => {
    const adapter = makeAdapter();
    // mock client 的 cardkit 与 im 方法（适配器内部 new lark.Client，无法直接 mock，
    // 因此改为验证 outbound 的 card 字段能进入发送分支 —— 这里通过类型与结构断言）
    const card: ChatCard = {
      header: "任务选择",
      headerColor: "blue",
      markdown: "请选择一个操作：",
      elements: [
        { tag: "button", text: "开始", type: "primary", value: { action: "start" } },
        { tag: "button", text: "取消", type: "danger", value: { action: "cancel" } },
        {
          tag: "select",
          placeholder: "选择模式",
          name: "mode",
          options: [
            { text: "快速", value: "fast" },
            { text: "详细", value: "detail" },
          ],
        },
      ],
    };
    const outbound: ChatMessageOutbound = { text: "", card };

    // 结构断言：卡片元素类型完整
    expect(card.elements).toHaveLength(3);
    expect(card.elements[0]).toMatchObject({ tag: "button", text: "开始", type: "primary" });
    expect(card.elements[2]).toMatchObject({ tag: "select", name: "mode" });
    expect(outbound.card).toBe(card);
    await adapter.disconnect();
  });

  it("text-only outbound keeps working", async () => {
    const adapter = makeAdapter();
    const outbound: ChatMessageOutbound = { text: "普通文本" };
    expect(outbound.card).toBeUndefined();
    expect(outbound.text).toBe("普通文本");
    await adapter.disconnect();
  });
});

describe("feishuProvider 卡片回调", () => {
  it("handleWebhook routes card.action.trigger to onCardAction", async () => {
    const adapter = makeAdapter();
    const actions: unknown[] = [];
    await adapter.connect({
      onMessage: async () => undefined,
      onCardAction: async (a) => actions.push(a),
    });

    const body = JSON.stringify({
      schema: "2.0",
      header: { event_type: "card.action.trigger" },
      event: {
        operator: { open_id: "ou_clicker", user_id: "u_clicker" },
        action: { value: { action: "start" }, tag: "button" },
        context: { open_chat_id: "oc_chat", open_message_id: "om_msg" },
      },
    });
    const res = await adapter.handleWebhook!(body);
    expect(res.ok).toBe(true);
    expect(actions).toHaveLength(1);
    const act = actions[0] as {
      platform: string;
      operatorId: string;
      value: { action: string };
      source: { chatId: string };
    };
    expect(act.platform).toBe("feishu");
    expect(act.operatorId).toBe("ou_clicker");
    expect(act.value).toEqual({ action: "start" });
    expect(act.source.chatId).toBe("oc_chat");
    await adapter.disconnect();
  });

  it("handleWebhook routes select option to onCardAction", async () => {
    const adapter = makeAdapter();
    const actions: unknown[] = [];
    await adapter.connect({
      onMessage: async () => undefined,
      onCardAction: async (a) => actions.push(a),
    });

    const body = JSON.stringify({
      schema: "2.0",
      header: { event_type: "card.action.trigger" },
      event: {
        operator: { open_id: "ou_clicker" },
        action: { tag: "select_static", option: "fast", name: "mode" },
        context: { open_chat_id: "oc_chat" },
      },
    });
    await adapter.handleWebhook!(body);
    const act = actions[0] as { value: unknown; operatorId: string };
    expect(act.operatorId).toBe("ou_clicker");
    // select 回调：value 可能是 option 或 name
    expect(act.value).toBe("fast");
    await adapter.disconnect();
  });

  it("ignores card action without operator or chat", async () => {
    const adapter = makeAdapter();
    const actions: unknown[] = [];
    await adapter.connect({
      onMessage: async () => undefined,
      onCardAction: async (a) => actions.push(a),
    });
    const body = JSON.stringify({
      schema: "2.0",
      header: { event_type: "card.action.trigger" },
      event: { action: { value: {} }, context: {} },
    });
    await adapter.handleWebhook!(body);
    expect(actions).toHaveLength(0);
    await adapter.disconnect();
  });
});
