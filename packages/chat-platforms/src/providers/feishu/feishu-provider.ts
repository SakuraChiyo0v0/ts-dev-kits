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

  // 机器人自身 open_id（群聊 @ 门控用）。connect 时异步拉取；拉取失败保持空。
  let botOpenId = "";

  /** 拉取机器人自身 open_id（GET /open-apis/bot/v3/info），失败静默（群聊门控保持严格） */
  async function fetchBotOpenId(): Promise<void> {
    try {
      const resp = await client.request({
        method: "GET",
        url: "/open-apis/bot/v3/info",
      });
      // lark client.request 返回的是响应体本身：{ bot: {...}, code, msg }
      // （个别版本包一层 data，兼容读取）
      const body = resp as Record<string, unknown> | undefined;
      const data = body?.data as Record<string, unknown> | undefined;
      const bot = (body?.bot ?? data?.bot) as Record<string, unknown> | undefined;
      const openId = bot?.open_id;
      if (typeof openId === "string" && openId) {
        botOpenId = openId;
      }
    } catch {
      // 拉取失败：botOpenId 保持空 → 群聊 @ 门控严格（只认 @all，不误判）
    }
  }

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

    // 群聊 @ 机器人检测：精确匹配。mentions 里存在 open_id 等于机器人自身的
    // 条目（@ 机器人本人），或 mentioned_type="all"（@所有人）时才算被 @。
    // 普通 @ 他人、或未 @ 的群消息（应用开了接收群内所有消息权限时会收到）
    // 一律不算，避免机器人不 @ 也乱说话。
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
          (m) =>
            m.mentioned_type === "all" ||
            m.mentioned_type === "ALL" ||
            (botOpenId !== "" && m.id?.open_id === botOpenId),
        )
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
    // 从按钮 value 解码会话类型（卡片即命令协议：value 里编码 chat_type）
    // 无 chat_type 时按私聊处理（旧行为兜底）
    const chatType =
      (typeof value === "object" && value !== null && (value as Record<string, unknown>).chat_type === "group")
        ? ("group" as const)
        : ("private" as const);
    // fire-and-forget：不等待 onCardAction 完成。
    // 飞书卡片回调限时 3 秒，而上层处理（LLM 对话）可能数秒，
    // 等待会导致"目标服务器回调超时未响应"。立即返回，后台处理。
    Promise.resolve(onCardAction?.({
      platform: "feishu",
      source: {
        platform: "feishu",
        chatId: openChatId,
        type: chatType,
        userId: operatorId,
      },
      operatorId,
      value: value as ChatCardAction["value"],
      raw: event,
    })).catch((err) => {
      console.error("[chat-platforms] 卡片回调处理失败:", err instanceof Error ? err.message : err);
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
  /**
   * 发送交互卡片：im.message 直接发 interactive，content 内嵌卡片 JSON（schema 2.0）。
   * 不走 cardkit 创建卡片实体（cardkit:card:write 权限机器人通常未开通，
   * 且 im.message 直接发 interactive 是老方式，仅需 im:message 权限）。
   */
  async function sendCard(source: ChatSource, message: ChatMessageOutbound): Promise<ChatSendResult> {
    const card = message.card!;
    const cardJson = buildCardJson(card);
    // update_multi 标记共享卡片，允许后续 patch（流式更新用）
    const cardPayload = { ...cardJson, config: { ...(cardJson.config ?? {}), update_multi: true } };
    const content = JSON.stringify(cardPayload);
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

  /**
   * 更新已发送的卡片消息（流式回复用）：im.message.patch 替换整个卡片内容。
   * 要求原卡片发送时带 config.update_multi（sendCard 已加），否则飞书拒绝 patch。
   */
  async function updateCardImpl(source: ChatSource, messageId: string, card: ChatCard): Promise<void> {
    const cardJson = buildCardJson(card);
    const cardPayload = { ...cardJson, config: { ...(cardJson.config ?? {}), update_multi: true } };
    // patch 只传 content（卡片 JSON），无需 msg_type（保持原 interactive 类型）
    await client.im.message.patch({
      path: { message_id: messageId },
      data: { content: JSON.stringify(cardPayload) },
    });
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
      // 异步拉取机器人自身 open_id（用于群聊 @ 门控精确匹配），失败不阻塞连接
      void fetchBotOpenId();
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
    async updateCard(source: ChatSource, messageId: string, card: ChatCard): Promise<void> {
      try {
        await updateCardImpl(source, messageId, card);
      } catch (error) {
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
  // 交互元素：schema 2.0 卡片按钮/下拉直接作为 body 元素（不支持 tag: action 容器）
  for (const el of card.elements) {
    if (el.tag === "button") {
      bodyElements.push({
        tag: "button",
        text: { tag: "plain_text", content: el.text },
        ...(el.type ? { type: el.type } : {}),
        ...(el.url ? { url: el.url } : {}),
        ...(el.value ? { value: el.value } : {}),
      });
    } else if (el.tag === "select") {
      bodyElements.push({
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
