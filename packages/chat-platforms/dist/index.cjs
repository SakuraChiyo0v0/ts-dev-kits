'use strict';

var lark = require('@larksuiteoapi/node-sdk');

function _interopNamespaceDefault(e) {
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () { return e[k]; }
                });
            }
        });
    }
    n.default = e;
    return Object.freeze(n);
}

var lark__namespace = /*#__PURE__*/_interopNamespaceDefault(lark);

/**
 * 多平台客户端：持有若干平台适配器，统一入口收发消息。
 * 上层（如 hoshino-ai 主进程）通过它管理所有已启用平台。
 */
class ChatPlatformClient {
    #adapters = new Map();
    #onMessage = null;
    /** 注册适配器实例并注入消息回调。同名平台重复注册会覆盖（先断开旧的）。 */
    async add(adapter) {
        await this.#adapters.get(adapter.name)?.disconnect();
        this.#adapters.set(adapter.name, adapter);
        await adapter.connect({
            onMessage: (message) => this.#onMessage?.(message),
        });
    }
    remove(name) {
        const adapter = this.#adapters.get(name);
        if (!adapter)
            return Promise.resolve();
        this.#adapters.delete(name);
        return adapter.disconnect();
    }
    get(name) {
        return this.#adapters.get(name);
    }
    list() {
        return [...this.#adapters.values()];
    }
    /** 设置统一入站消息处理器（收到任何平台消息都会回调） */
    onMessage(handler) {
        this.#onMessage = handler;
    }
    /** 向指定平台会话发送消息 */
    async send(source, message) {
        const adapter = this.#adapters.get(source.platform);
        if (!adapter) {
            throw new Error(`no adapter for platform "${source.platform}"`);
        }
        return adapter.send(source, message);
    }
    /** 断开所有平台 */
    async disconnectAll() {
        const adapters = [...this.#adapters.values()];
        this.#adapters.clear();
        await Promise.allSettled(adapters.map((adapter) => adapter.disconnect()));
    }
}

class ChatPlatformError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = "ChatPlatformError";
        this.code = code;
    }
}
/** 从任意错误归类为统一错误码（参考 email 包 toEmailError 模式） */
function toChatPlatformError(error) {
    if (error instanceof ChatPlatformError) {
        return error;
    }
    const record = typeof error === "object" && error !== null
        ? error
        : {};
    const sourceMessage = error instanceof Error ? error.message : "Unknown chat platform error";
    const code = String(record.code ?? "");
    if (code.startsWith("E_") || code === "E_AUTH") {
        return new ChatPlatformError("AUTHENTICATION", sourceMessage, { cause: error });
    }
    if (code.startsWith("ECONN") ||
        code === "ETIMEDOUT" ||
        code === "E_WS_CONNECT_FAILED") {
        return new ChatPlatformError("CONNECTION", sourceMessage, { cause: error });
    }
    if (code === "E_NOT_FOUND" || code === "E_CHAT_NOT_FOUND") {
        return new ChatPlatformError("NOT_FOUND", sourceMessage, { cause: error });
    }
    return new ChatPlatformError("UNKNOWN", sourceMessage, { cause: error });
}

/**
 * 平台适配器注册表。
 * 参考 hermes PlatformRegistry 模式：注册表 + 工厂，新增平台零改核心。
 */
class ChatPlatformRegistry {
    #entries = new Map();
    register(entry) {
        if (this.#entries.has(entry.id)) {
            throw new ChatPlatformError("CONFIGURATION", `platform "${entry.id}" is already registered`);
        }
        this.#entries.set(entry.id, entry);
    }
    get(id) {
        return this.#entries.get(id);
    }
    list() {
        return [...this.#entries.values()];
    }
    /** 按 id 创建适配器；未注册时报错 */
    create(id, options) {
        const entry = this.#entries.get(id);
        if (!entry) {
            throw new ChatPlatformError("CONFIGURATION", `unknown chat platform "${id}"`);
        }
        return entry.create(options);
    }
}
/** 全局默认注册表（包内预置平台会自动注册到这里） */
const defaultRegistry = new ChatPlatformRegistry();
/** 便捷函数：向全局默认注册表注册 */
function registerPlatform(entry) {
    defaultRegistry.register(entry);
}

/** 事件处理错误码映射（飞书错误码 → 统一错误码） */
const FEISHU_ERROR_MAP = {
    99991663: "AUTHENTICATION", // 租户访问令牌无效
    99991664: "AUTHENTICATION", // 无效访问令牌
    230002: "AUTHENTICATION", // 没有权限
    230001: "NOT_FOUND", // 群不存在
    230005: "NOT_FOUND", // 群不存在
    230101: "VALIDATION", // 消息内容格式错误
};
/** 归一化飞书错误码 */
function feishuErrorCode(code) {
    // 230000-230099 段多为用户/群/消息不存在类错误
    if (code >= 230000 && code < 230100) {
        return "NOT_FOUND";
    }
    return FEISHU_ERROR_MAP[code] ?? "UNKNOWN";
}
/** 校验配置，返回错误信息（null 表示通过） */
function validateFeishuConfig(config) {
    if (typeof config !== "object" || config === null) {
        return "飞书配置必须是对象";
    }
    const c = config;
    if (!c.appId || typeof c.appId !== "string" || !c.appId.trim()) {
        return "缺少飞书 appId（应用凭证）";
    }
    if (!c.appSecret || typeof c.appSecret !== "string" || !c.appSecret.trim()) {
        return "缺少飞书 appSecret（应用凭证）";
    }
    const transport = c.transport ?? "websocket";
    if (transport !== "websocket" && transport !== "webhook") {
        return `不支持的 transport: ${String(transport)}`;
    }
    if (transport === "webhook" && !c.verificationToken && !c.encryptKey) {
        return "webhook 模式需要配置 verificationToken 或 encryptKey（用于事件验签）";
    }
    return null;
}

/**
 * 飞书适配器。
 * 入站：im.message.receive_v1 事件（长连接或 webhook 均可）→ 归一化 ChatMessage。
 * 出站：im.message.create 发新消息；im.message.reply 回复指定消息。
 */
function feishuProvider(config) {
    validateFeishuConfig(config);
    const client = new lark__namespace.Client({
        appId: config.appId,
        appSecret: config.appSecret,
    });
    let wsClient = null;
    let onMessage = null;
    /** 从事件数据提取消息内容（文本/富文本 → 可读文本） */
    function extractText(rawContent, msgType) {
        try {
            const parsed = JSON.parse(rawContent);
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
                        if (typeof line !== "object" || line === null)
                            return "";
                        const l = line;
                        return l.text !== undefined ? String(l.text) : "";
                    })
                        .join("");
                }
                return "";
            }
            return "";
        }
        catch {
            return "";
        }
    }
    /** im.message.receive_v1 事件 → ChatMessage */
    function toChatMessage(event) {
        const message = event.message;
        if (!message)
            return null;
        const chatType = message.chat_type === "group" ? "group" : "private";
        const text = extractText(message.content ?? "", message.message_type ?? "");
        if (!text.trim())
            return null; // 忽略图片/文件等非文本消息（后续版本扩展）
        const sender = event.sender;
        const userId = sender?.sender_id?.user_id ?? sender?.sender_id?.open_id ?? sender?.sender_id?.union_id;
        const source = {
            platform: "feishu",
            chatId: message.chat_id ?? "",
            type: chatType,
            ...(userId ? { userId } : {}),
        };
        return {
            messageId: message.message_id ?? "",
            source,
            text,
            raw: event,
            ...(message.parent_id ? { replyToMessageId: message.parent_id } : {}),
        };
    }
    async function handleEvent(event) {
        const message = toChatMessage(event);
        if (!message)
            return;
        if (message.source.type === "private" && config.enablePrivateChat === false)
            return;
        await onMessage?.(message);
    }
    /** 发送消息：有 replyToMessageId 走回复，否则发新消息 */
    async function sendMessage(source, message) {
        try {
            const content = JSON.stringify({ text: message.text });
            const data = { msg_type: "text", content };
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
        }
        catch (error) {
            throw toFeishuError(error);
        }
    }
    return {
        name: "feishu",
        capabilities: {
            supportsRichText: false,
            supportsImages: false,
            splitsLongMessages: false,
        },
        async connect({ onMessage: handler }) {
            onMessage = handler;
            if (config.transport === "webhook") {
                return;
            }
            // 长连接模式
            wsClient = new lark__namespace.WSClient({
                appId: config.appId,
                appSecret: config.appSecret,
                loggerLevel: lark__namespace.LoggerLevel.info,
            });
            await wsClient.start({
                eventDispatcher: new lark__namespace.EventDispatcher({}).register({
                    "im.message.receive_v1": handleEvent,
                }),
            });
        },
        async disconnect() {
            if (wsClient) {
                await wsClient.close();
                wsClient = null;
            }
        },
        async send(source, message) {
            return sendMessage(source, message);
        },
        async handleWebhook(body) {
            const data = JSON.parse(body);
            // 飞书 URL 配置校验：返回 challenge
            if (data.type === "url_verification" && typeof data.challenge === "string") {
                return { challenge: data.challenge, ok: true };
            }
            // 事件类型：schema 2.0 在 header.event_type，旧格式在顶层 type
            const header = data.header;
            const eventType = (header?.event_type ?? data.type);
            const event = data.event;
            if (eventType === "im.message.receive_v1" && event) {
                await handleEvent(event);
                return { ok: true };
            }
            return { ok: true };
        },
    };
}
/** 从飞书 SDK 错误归类为统一错误 */
function toFeishuError(error) {
    const record = typeof error === "object" && error !== null
        ? error
        : {};
    const code = Number(record.code ?? 0);
    // lark SDK 抛的是 { code, msg } 对象而非 Error 实例
    const rawMsg = (typeof record.msg === "string" && record.msg) ||
        (typeof record.message === "string" && record.message) ||
        (error instanceof Error ? error.message : "") ||
        "飞书 API 调用失败";
    return new ChatPlatformError(feishuErrorCode(code), rawMsg, { cause: error });
}

/** 向默认注册表注册飞书平台 */
function registerFeishuPlatform() {
    registerPlatform({
        id: "feishu",
        label: "飞书",
        create: (config) => feishuProvider(config),
        validateConfig: validateFeishuConfig,
    });
}

exports.ChatPlatformClient = ChatPlatformClient;
exports.ChatPlatformError = ChatPlatformError;
exports.ChatPlatformRegistry = ChatPlatformRegistry;
exports.defaultRegistry = defaultRegistry;
exports.feishuProvider = feishuProvider;
exports.registerFeishuPlatform = registerFeishuPlatform;
exports.registerPlatform = registerPlatform;
exports.toChatPlatformError = toChatPlatformError;
exports.validateFeishuConfig = validateFeishuConfig;
