import * as lark from '@larksuiteoapi/node-sdk';

/** 滑动窗口限流器（每会话独立） */
class RateLimiter {
    #timestamps = new Map();
    #windowSeconds;
    #maxMessages;
    constructor(windowSeconds, maxMessages) {
        this.#windowSeconds = windowSeconds;
        this.#maxMessages = maxMessages;
    }
    /** 尝试放行一条消息，返回 false 表示超过限流 */
    allow(key, nowMs = Date.now()) {
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
function createPolicyChecker(policy) {
    return new PolicyChecker(policy);
}
/**
 * 策略执行器：判定一条入站消息是否应响应。
 * 判断顺序：黑名单 → 白名单 → 唤醒词 → 关键词 → 限流 → 表情回应。
 */
class PolicyChecker {
    #policy;
    #rateLimiter;
    constructor(policy) {
        this.#policy = policy;
        this.#rateLimiter = policy.rateLimit
            ? new RateLimiter(policy.rateLimit.windowSeconds, policy.rateLimit.maxMessages)
            : null;
    }
    get policy() {
        return this.#policy;
    }
    /**
     * 判定消息；返回 respond（可能带表情回应）或 ignore/blocked。
     * 注意：respond 时可能附带 strippedText（去掉唤醒词后的正文）。
     */
    decide(message) {
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
        // 私聊（且未开唤醒要求）视为已唤醒；群聊命中唤醒词视为已唤醒
        const isWoken = woken || isPrivate;
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
    pickReaction() {
        const { enabled, emojis } = this.#policy.emojiReaction;
        if (!enabled || emojis.length === 0)
            return undefined;
        return emojis[Math.floor(Math.random() * emojis.length)];
    }
}

/**
 * 多平台客户端：持有若干平台适配器，统一入口收发消息。
 * 上层（如 hoshino-ai 主进程）通过它管理所有已启用平台。
 * 可配置响应策略：收到消息先过策略（白名单/黑名单/唤醒/关键词/限流/表情），再决定是否回调。
 */
class ChatPlatformClient {
    #adapters = new Map();
    #checkers = new Map();
    #onMessage = null;
    #onBlocked = null;
    /**
     * 注册适配器实例并注入消息回调。
     * policy 为可选：提供后，入站消息先过策略再决定是否回调。
     */
    async add(adapter, policy) {
        await this.#adapters.get(adapter.name)?.disconnect();
        this.#adapters.set(adapter.name, adapter);
        this.#checkers.set(adapter.name, policy ? createPolicyChecker(policy) : null);
        await adapter.connect({
            onMessage: (message) => this.#route(adapter.name, message),
        });
    }
    /** 更新某平台的响应策略（不改动连接） */
    setPolicy(name, policy) {
        if (policy) {
            this.#checkers.set(name, createPolicyChecker(policy));
        }
        else {
            this.#checkers.delete(name);
        }
    }
    remove(name) {
        const adapter = this.#adapters.get(name);
        if (!adapter)
            return Promise.resolve();
        this.#adapters.delete(name);
        this.#checkers.delete(name);
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
    /** 设置被策略拦截（blocked）时的处理器（可发送提示回复） */
    onBlocked(handler) {
        this.#onBlocked = handler;
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
        this.#checkers.clear();
        await Promise.allSettled(adapters.map((adapter) => adapter.disconnect()));
    }
    /** 入站消息路由：过策略 → 回调 or 拦截 */
    async #route(platform, message) {
        const checker = this.#checkers.get(platform);
        if (checker) {
            const decision = checker.decide(message);
            if (decision.action === "ignore") {
                return;
            }
            if (decision.action === "blocked") {
                await this.#onBlocked?.(message, decision.replyText);
                return;
            }
            // respond：若去掉了唤醒词，把处理后的文本回填
            if (decision.strippedText !== undefined) {
                message.text = decision.strippedText;
            }
            // 表情回应：若适配器支持 react 且策略选出了表情
            if (decision.reaction) {
                await this.#adapters.get(platform)?.react?.(message, decision.reaction).catch(() => undefined);
            }
        }
        await this.#onMessage?.(message);
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

/**
 * 消息响应策略 —— 平台无关的入站消息控制层。
 * 参考 AstrBot platform_settings 设计：白名单/黑名单/唤醒/关键词/限流/表情回应。
 * 上层（如 hoshino-ai）通过 ChatResponsePolicy 控制"哪些消息值得响应"。
 */
/** 默认策略：全放行，不限制 */
function defaultPolicy() {
    return {
        enableWhitelist: false,
        userWhitelist: [],
        groupWhitelist: [],
        userBlacklist: [],
        groupBlacklist: [],
        adminUserIds: [],
        ignoreAdminInGroup: true,
        ignoreAdminInPrivate: true,
        replyWhenBlocked: false,
        blockedReplyText: "我没有权限与你对话。",
        groupWakePrefixes: [],
        privateNeedsWakePrefix: false,
        ignoreBotSelf: false,
        ignoreAtAll: false,
        blockedKeywords: [],
        rateLimit: null,
        emojiReaction: { enabled: false, emojis: [] },
    };
}
/** 校验策略配置，返回错误信息（null 表示通过） */
function validatePolicy(policy) {
    if (typeof policy !== "object" || policy === null) {
        return "策略配置必须是对象";
    }
    if (policy.enableWhitelist && policy.userWhitelist.length === 0 && policy.groupWhitelist.length === 0) {
        return "启用白名单但用户/群白名单均为空，将无人可对话";
    }
    for (const keyword of policy.blockedKeywords) {
        if (!keyword.trim()) {
            return "屏蔽关键词不能为空字符串";
        }
    }
    if (policy.rateLimit) {
        if (policy.rateLimit.windowSeconds <= 0 || policy.rateLimit.maxMessages <= 0) {
            return "限流窗口与最大消息数必须为正数";
        }
    }
    return null;
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
 * 飞书表情回应支持的表情 key（英文枚举，非 Unicode emoji）。
 * 完整 182 个见官方文档：https://open.feishu.cn/document/server-docs/im-v1/message-reaction/emojis-introduce
 * 这里收录常用子集；传不在此列表的值飞书 API 会返回 400/231001。
 */
const FEISHU_EMOJI_KEYS = [
    "OK",
    "THUMBSUP",
    "THANKS",
    "Typing",
    "LGTM",
    "OnIt",
    "OneSecond",
    "ThumbsDown",
    "RoarForYou",
    "FACEPALM",
    "REDPACKET",
    "EatingFood",
    "MeMeMe",
    "Sigh",
    "Get",
    "Lemon",
    "VRHeadset",
    "YouAreTheBest",
    "Clap",
    "Heart",
    "Fire",
    "666",
];
/** 校验表情 key 是否合法（飞书支持）；返回错误信息（null 表示合法） */
function validateFeishuEmoji(emoji) {
    if (!emoji.trim()) {
        return "表情不能为空";
    }
    // Unicode emoji（含非 ASCII 字符）直接判非法
    if (/[^\x00-\x7F]/u.test(emoji)) {
        return `"${emoji}" 不是飞书表情 key。飞书用英文枚举（如 THUMBSUP / OK / Typing），不是 Unicode emoji（如 👍）`;
    }
    if (!FEISHU_EMOJI_KEYS.includes(emoji)) {
        return `"${emoji}" 不在已知飞书表情列表中。可用：${FEISHU_EMOJI_KEYS.join("、")}（完整列表见飞书文档）`;
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
    const client = new lark.Client({
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
        // 过滤机器人自己发的消息（sender_type === "app"），否则机器人回复会再次触发入站 → 无限循环
        const senderType = event.sender?.sender_type;
        if (senderType === "app")
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
            wsClient = new lark.WSClient({
                appId: config.appId,
                appSecret: config.appSecret,
                loggerLevel: lark.LoggerLevel.info,
            });
            await wsClient.start({
                eventDispatcher: new lark.EventDispatcher({}).register({
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
        async react(message, emoji) {
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
            }
            catch (error) {
                // 表情回应失败不阻断主流程
                throw toFeishuError(error);
            }
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

export { ChatPlatformClient, ChatPlatformError, ChatPlatformRegistry, FEISHU_EMOJI_KEYS, PolicyChecker, createPolicyChecker, defaultPolicy, defaultRegistry, feishuProvider, registerFeishuPlatform, registerPlatform, toChatPlatformError, validateFeishuConfig, validateFeishuEmoji, validatePolicy };
