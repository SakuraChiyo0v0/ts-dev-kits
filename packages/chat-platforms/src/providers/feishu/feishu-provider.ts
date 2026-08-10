import * as lark from "@larksuiteoapi/node-sdk";
import type {
  ChatCard,
  ChatCardAction,
  ChatMessage,
  ChatMessageOutbound,
  ChatMessageType,
  ChatPlatformAdapter,
  ChatSendResult,
  ChatSource,
} from "../../types.js";
import { ChatPlatformError } from "../../errors.js";
import {
  feishuErrorCode,
  validateFeishuConfig,
  validateFeishuEmoji,
  type FeishuConfig,
} from "./feishu-types.js";

/** 飞书 im.message.receive_v1 事件的 data 类型 */
type FeishuMessageEvent = Parameters<
  NonNullable<lark.EventHandles["im.message.receive_v1"]>
>[0];

/**
 * 飞书适配器。
 * 入站：im.message.receive_v1 事件（长连接或 webhook 均可）→ 归一化 ChatMessage。
 * 出站：im.message.create 发新消息；im.message.reply 回复指定消息。
 */
export function feishuProvider(config: FeishuConfig): ChatPlatformAdapter {
  validateFeishuConfig(config);
  const client = new lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
  });

  let wsClient: lark.WSClient | null = null;
  let onMessage: ((message: ChatMessage) => void | Promise<void>) | null = null;
  let onCardAction: ((action: ChatCardAction) => void | Promise<void>) | null = null;
  let connected = false;

  /** 从事件数据提取消息内容（文本/富文本 → 可读文本） */
  function extractText(rawContent: string, msgType: string): string {
    try {
      const parsed = JSON.parse(rawContent) as Record<string, unknown>;
      if (msgType === "text") {
        return typeof parsed.text === "string" ? parsed.text : "";
      }
      if (msgType === "post") {
        // 富文本 post：content 是 { title?, content: [[{ tag: 'text', text: '...' }]] }
        const content = parsed.content;
        if (Array.isArray(content)) {
          return content
            .flat()
            .map((line) => {
              if (typeof line !== "object" || line === null) return "";
              const l = line as Record<string, unknown>;
              return l.text !== undefined ? String(l.text) : "";
            })
            .join("");
        }
        return "";
      }
      return "";
    } catch {
      return "";
    }
  }

  /** im.message.receive_v1 事件 → ChatMessage */
  function toChatMessage(event: FeishuMessageEvent): ChatMessage | null {
    const message = event.message;
    if (!message) return null;
    const chatType = message.chat_type === "group" ? "group" : "private";
    const text = extractText(message.content ?? "", message.message_type ?? "");
    if (!text.trim()) return null; // 忽略图片/文件等非文本消息（后续版本扩展）

    const sender = event.sender;
    const userId =
      sender?.sender_id?.user_id ?? sender?.sender_id?.open_id ?? sender?.sender_id?.union_id;

    // 群聊 @ 机器人检测：飞书机器人默认只收到 @ 它的群消息（除非开了接收群内所有消息权限）。
    // 因此群聊消息一律视为被 @ 唤醒；@all（mentioned_type="all"）也算被 @。
    // 若将来开了"接收群内所有消息"，可改为精确匹配机器人 open_id。
    let mentionedBot = false;
    if (chatType === "group") {
      const mentions = (
        message as {
          mentions?: Array<{
            key?: string
            id?: { union_id?: string; user_id?: string; open_id?: string }
            name?: string
            mentioned_type?: string
          }>
        }
      ).mentions
      if (Array.isArray(mentions) && mentions.length > 0) {
        mentionedBot = mentions.some(
          (m) => m.mentioned_type === "all" || m.mentioned_type === "ALL",
        )
      } else {
        // 无 mentions 字段也按被 @ 处理（机器人默认只收 @ 消息）
        mentionedBot = true
      }
    }

    const source: ChatSource = {
      platform: "feishu",
      chatId: message.chat_id ?? "",
      type: chatType as ChatMessageType,
      ...(userId ? { userId } : {}),
      ...(mentionedBot ? { mentionedBot: true } : {}),
    };

    return {
      messageId: message.message_id ?? "",
      source,
      text,
      raw: event,
      ...(message.parent_id ? { replyToMessageId: message.parent_id } : {}),
    };
  }

  async function handleEvent(event: FeishuMessageEvent): Promise<void> {
    const message = toChatMessage(event);
    if (!message) return;
    if (message.source.type === "private" && config.enablePrivateChat === false) return;

    // 过滤机器人自己发的消息（sender_type === "app"），否则机器人回复会再次触发入站 → 无限循环
    const senderType = event.sender?.sender_type;
    if (senderType === "app") return;

    await onMessage?.(message);
  }

  /** card.action.trigger 事件（用户点击卡片按钮/菜单）→ 归一化 ChatCardAction */
  async function handleCardAction(event: unknown): Promise<void> {
    const raw = (typeof event === "object" && event !== null ? event : {}) as Record<string, unknown>;
    // 事件结构：operator 操作者 + action.value + context.open_chat_id/open_message_id
    const operator = (typeof raw.operator === "object" && raw.operator !== null ? raw.operator : {}) as Record<string, unknown>;
    const action = (typeof raw.action === "object" && raw.action !== null ? raw.action : {}) as Record<string, unknown>;
    const context = (typeof raw.context === "object" && raw.context !== null ? raw.context : {}) as Record<string, unknown>;
    const openChatId = (context.open_chat_id ?? raw.open_chat_id) as string | undefined;
    const openMessageId = (context.open_message_id ?? raw.open_message_id) as string | undefined;

    const operatorId =
      (operator.open_id as string | undefined) ??
      (operator.user_id as string | undefined) ??
      (operator.union_id as string | undefined) ??
      "";

    if (!operatorId || !openChatId) return;

    const value = action.value ?? action.option ?? action.name ?? "";
    await onCardAction?.({
      platform: "feishu",
      source: {
        platform: "feishu",
        chatId: openChatId,
        type: "private", // 卡片回调不区分群/私聊，用会话 id 定位即可
        userId: operatorId,
      },
      operatorId,
      value: value as ChatCardAction["value"],
      raw: event,
    });
  }

  /** 发送消息：有 replyToMessageId 走回复，否则发新消息；带 card 时发交互卡片 */
  async function sendMessage(source: ChatSource, message: ChatMessageOutbound): Promise<ChatSendResult> {
    try {
      // 交互卡片优先：cardkit.create 创建卡片实体 → im.message 发送 interactive
      if (message.card) {
        return sendCard(source, message);
      }

      const content = JSON.stringify({ text: message.text });
      const data: {
        receive_id?: string;
        msg_type: string;
        content: string;
        reply_in_thread?: boolean;
      } = { msg_type: "text", content };

      if (message.replyToMessageId) {
        // 回复指定消息：im.message.reply，receive_id 用消息所在会话
        const res = await client.im.message.reply({
          path: { message_id: message.replyToMessageId },
          data: { content, msg_type: "text" },
        });
        return { platform: "feishu", ok: true, messageId: res.data?.message_id ?? "" };
      }

      const res = await client.im.message.create({
        // chat_id 类型同时支持群会话与 p2p 会话（入站的 chat_id 都是 oc_xxx 格式）
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: source.chatId,
          msg_type: "text",
          content,
        },
      });
      return { platform: "feishu", ok: true, messageId: res.data?.message_id ?? "" };
    } catch (error) {
      throw toFeishuError(error);
    }
  }

  /** 发送交互卡片：CardKit 创建卡片实体 → interactive 消息 */
  async function sendCard(source: ChatSource, message: ChatMessageOutbound): Promise<ChatSendResult> {
    const card = message.card!;
    const cardJson = buildCardJson(card);
    // 1. 创建卡片实体（schema 2.0）
    const created = await client.cardkit.v1.card.create({
      data: { type: "card_json", data: JSON.stringify(cardJson) },
    });
    const cardId = created.data?.card_id;
    if (!cardId) {
      throw new ChatPlatformError("DELIVERY", "飞书卡片创建失败：未返回 card_id");
    }
    // 2. 以 interactive 消息发送
    const content = JSON.stringify({ type: "card", data: { card_id: cardId } });
    if (message.replyToMessageId) {
      const res = await client.im.message.reply({
        path: { message_id: message.replyToMessageId },
        data: { content, msg_type: "interactive" },
      });
      return { platform: "feishu", ok: true, messageId: res.data?.message_id ?? "" };
    }
    const res = await client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: { receive_id: source.chatId, msg_type: "interactive", content },
    });
    return { platform: "feishu", ok: true, messageId: res.data?.message_id ?? "" };
  }

  return {
    name: "feishu",
    capabilities: {
      supportsRichText: false,
      supportsImages: false,
      splitsLongMessages: false,
    },
    async connect({ onMessage: handler, onCardAction: cardHandler }): Promise<void> {
      onMessage = handler;
      onCardAction = cardHandler ?? null;
      if (config.transport === "webhook") {
        // webhook 模式：由外部 HTTP 服务把事件 POST 进来（见 handleWebhook）
        connected = true;
        return;
      }
      // 长连接模式
      wsClient = new lark.WSClient({
        appId: config.appId,
        appSecret: config.appSecret,
        loggerLevel: lark.LoggerLevel.info,
      });
      await wsClient.start({
        eventDispatcher: new lark.EventDispatcher({}).register({
          "im.message.receive_v1": handleEvent,
          // 卡片按钮/菜单点击回调（schema 2.0 卡片）
          "card.action.trigger": handleCardAction,
        }),
      });
      connected = true;
    },
    async disconnect(): Promise<void> {
      connected = false;
      if (wsClient) {
        await wsClient.close();
        wsClient = null;
      }
    },
    async send(source, message): Promise<ChatSendResult> {
      return sendMessage(source, message);
    },
    async handleWebhook(body: string): Promise<{ challenge?: string; ok: boolean }> {
      const data = JSON.parse(body) as Record<string, unknown>;
      // 飞书 URL 配置校验：返回 challenge
      if (data.type === "url_verification" && typeof data.challenge === "string") {
        return { challenge: data.challenge, ok: true };
      }
      // 事件类型：schema 2.0 在 header.event_type，旧格式在顶层 type
      const header = data.header as Record<string, unknown> | undefined;
      const eventType = (header?.event_type ?? data.type) as string | undefined;
      const event = data.event as FeishuMessageEvent | undefined;
      if (eventType === "im.message.receive_v1" && event) {
        await handleEvent(event);
        return { ok: true };
      }
      // 卡片按钮/菜单点击（webhook 模式）
      if (eventType === "card.action.trigger" && data.event) {
        await handleCardAction(data.event);
        return { ok: true };
      }
      return { ok: true };
    },
    async react(message: ChatMessage, emoji: string): Promise<void> {
      const invalid = validateFeishuEmoji(emoji);
      if (invalid) {
        // 飞书 emoji_type 是英文枚举 key；传 Unicode 会报 400/231001
        throw new ChatPlatformError("VALIDATION", invalid);
      }
      try {
        await client.im.messageReaction.create({
          path: { message_id: message.messageId },
          data: { reaction_type: { emoji_type: emoji } },
        });
      } catch (error) {
        // 表情回应失败不阻断主流程
        throw toFeishuError(error);
      }
    },
  };
}

/** 从飞书 SDK 错误归类为统一错误 */
function toFeishuError(error: unknown): ChatPlatformError {
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const code = Number(record.code ?? 0);
  // lark SDK 抛的是 { code, msg } 对象而非 Error 实例
  const rawMsg =
    (typeof record.msg === "string" && record.msg) ||
    (typeof record.message === "string" && record.message) ||
    (error instanceof Error ? error.message : "") ||
    "飞书 API 调用失败";
  return new ChatPlatformError(feishuErrorCode(code), rawMsg, { cause: error });
}

/**
 * 把平台无关的 ChatCard 转成飞书 schema 2.0 卡片 JSON。
 * 按钮带 value（回调原样带回），select 映射为下拉菜单。
 */
function buildCardJson(card: ChatCard): Record<string, unknown> {
  const bodyElements: unknown[] = [];
  if (card.markdown) {
    bodyElements.push({ tag: "markdown", content: card.markdown });
  }
  // 交互元素：按钮/菜单合并进一个 action 容器
  const actions: unknown[] = [];
  for (const el of card.elements) {
    if (el.tag === "button") {
      actions.push({
        tag: "button",
        text: { tag: "plain_text", content: el.text },
        ...(el.type ? { type: el.type } : {}),
        ...(el.url ? { url: el.url } : {}),
        ...(el.value ? { value: el.value } : {}),
      });
    } else if (el.tag === "select") {
      actions.push({
        tag: "select_static",
        ...(el.placeholder ? { placeholder: { tag: "plain_text", content: el.placeholder } } : {}),
        ...(el.name ? { name: el.name } : {}),
        options: el.options.map((o) => ({
          text: { tag: "plain_text", content: o.text },
          value: o.value,
        })),
      });
    }
  }
  if (actions.length > 0) {
    bodyElements.push({ tag: "action", actions });
  }

  const cardJson: Record<string, unknown> = {
    schema: "2.0",
    body: { elements: bodyElements },
  };
  if (card.header) {
    cardJson.header = {
      title: { tag: "plain_text", content: card.header },
      ...(card.headerColor
        ? { template: card.headerColor }
        : { template: "blue" }),
    };
  }
  return cardJson;
}
