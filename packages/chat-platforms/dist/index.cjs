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
        // 群聊门控：未 @ 机器人、未命中唤醒词、且未开启"响应所有群消息"时忽略。
        // （飞书应用若开启"接收群内所有消息"权限，未 @ 的群消息也会推送进来，
        //  不加这个门控机器人会在群里对每条消息都回话。）
        if (isGroup && !woken && source.mentionedBot !== true && !this.#policy.respondToUnmentionedGroup) {
            return { action: "ignore", reason: "not-mentioned" };
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
    #onCardAction = null;
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
            onCardAction: (action) => this.#onCardAction?.(action),
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
    /** 设置卡片按钮/菜单点击处理器 */
    onCardAction(handler) {
        this.#onCardAction = handler;
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
                await this.#adapters
                    .get(platform)
                    ?.react?.(message, decision.reaction)
                    .catch((err) => {
                    console.error(`[chat-platforms] 表情回应失败(${platform}):`, err instanceof Error ? err.message : err);
                });
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
        respondToUnmentionedGroup: false,
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
    const client = new lark__namespace.Client({
        appId: config.appId,
        appSecret: config.appSecret,
    });
    let wsClient = null;
    let onMessage = null;
    let onCardAction = null;
    // 机器人自身 open_id（群聊 @ 门控用）。connect 时异步拉取；拉取失败保持空。
    let botOpenId = "";
    /** 拉取机器人自身 open_id（GET /open-apis/bot/v3/info），失败静默（群聊门控保持严格） */
    async function fetchBotOpenId() {
        try {
            const resp = await client.request({
                method: "GET",
                url: "/open-apis/bot/v3/info",
            });
            const data = resp?.data;
            const bot = data?.bot;
            const openId = bot?.open_id;
            if (typeof openId === "string" && openId) {
                botOpenId = openId;
            }
        }
        catch {
            // 拉取失败：botOpenId 保持空 → 群聊 @ 门控严格（只认 @all，不误判）
        }
    }
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
        // 群聊 @ 机器人检测：精确匹配。mentions 里存在 open_id 等于机器人自身的
        // 条目（@ 机器人本人），或 mentioned_type="all"（@所有人）时才算被 @。
        // 普通 @ 他人、或未 @ 的群消息（应用开了接收群内所有消息权限时会收到）
        // 一律不算，避免机器人不 @ 也乱说话。
        let mentionedBot = false;
        if (chatType === "group") {
            const mentions = message.mentions;
            if (Array.isArray(mentions) && mentions.length > 0) {
                mentionedBot = mentions.some((m) => m.mentioned_type === "all" ||
                    m.mentioned_type === "ALL" ||
                    (botOpenId !== "" && m.id?.open_id === botOpenId));
            }
        }
        const source = {
            platform: "feishu",
            chatId: message.chat_id ?? "",
            type: chatType,
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
    /** card.action.trigger 事件（用户点击卡片按钮/菜单）→ 归一化 ChatCardAction */
    async function handleCardAction(event) {
        const raw = (typeof event === "object" && event !== null ? event : {});
        // 事件结构：operator 操作者 + action.value + context.open_chat_id/open_message_id
        const operator = (typeof raw.operator === "object" && raw.operator !== null ? raw.operator : {});
        const action = (typeof raw.action === "object" && raw.action !== null ? raw.action : {});
        const context = (typeof raw.context === "object" && raw.context !== null ? raw.context : {});
        const openChatId = (context.open_chat_id ?? raw.open_chat_id);
        (context.open_message_id ?? raw.open_message_id);
        const operatorId = operator.open_id ??
            operator.user_id ??
            operator.union_id ??
            "";
        if (!operatorId || !openChatId)
            return;
        const value = action.value ?? action.option ?? action.name ?? "";
        // 从按钮 value 解码会话类型（卡片即命令协议：value 里编码 chat_type）
        // 无 chat_type 时按私聊处理（旧行为兜底）
        const chatType = (typeof value === "object" && value !== null && value.chat_type === "group")
            ? "group"
            : "private";
        await onCardAction?.({
            platform: "feishu",
            source: {
                platform: "feishu",
                chatId: openChatId,
                type: chatType,
                userId: operatorId,
            },
            operatorId,
            value: value,
            raw: event,
        });
    }
    /** 发送消息：有 replyToMessageId 走回复，否则发新消息；带 card 时发交互卡片 */
    async function sendMessage(source, message) {
        try {
            // 交互卡片优先：cardkit.create 创建卡片实体 → im.message 发送 interactive
            if (message.card) {
                return sendCard(source, message);
            }
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
    /** 发送交互卡片：CardKit 创建卡片实体 → interactive 消息 */
    async function sendCard(source, message) {
        const card = message.card;
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
        async connect({ onMessage: handler, onCardAction: cardHandler }) {
            onMessage = handler;
            onCardAction = cardHandler ?? null;
            // 异步拉取机器人自身 open_id（用于群聊 @ 门控精确匹配），失败不阻塞连接
            void fetchBotOpenId();
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
                    // 卡片按钮/菜单点击回调（schema 2.0 卡片）
                    "card.action.trigger": handleCardAction,
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
            // 卡片按钮/菜单点击（webhook 模式）
            if (eventType === "card.action.trigger" && data.event) {
                await handleCardAction(data.event);
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
/**
 * 把平台无关的 ChatCard 转成飞书 schema 2.0 卡片 JSON。
 * 按钮带 value（回调原样带回），select 映射为下拉菜单。
 */
function buildCardJson(card) {
    const bodyElements = [];
    if (card.markdown) {
        bodyElements.push({ tag: "markdown", content: card.markdown });
    }
    // 交互元素：按钮/菜单合并进一个 action 容器
    const actions = [];
    for (const el of card.elements) {
        if (el.tag === "button") {
            actions.push({
                tag: "button",
                text: { tag: "plain_text", content: el.text },
                ...(el.type ? { type: el.type } : {}),
                ...(el.url ? { url: el.url } : {}),
                ...(el.value ? { value: el.value } : {}),
            });
        }
        else if (el.tag === "select") {
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
    const cardJson = {
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

/** 向默认注册表注册飞书平台 */
function registerFeishuPlatform() {
    registerPlatform({
        id: "feishu",
        label: "飞书",
        create: (config) => feishuProvider(config),
        validateConfig: validateFeishuConfig,
    });
}

/**
 * 卡片命令协议 —— 借鉴 Reasonix internal/bot/render.go 的"卡片即命令"设计。
 *
 * 核心思想：卡片按钮的 value 编码"要执行的命令 + 路由上下文"（command/chat_type/user_id）。
 * 用户点击按钮 → card.action.trigger 回调 → SDK 解码出 command，重新作为入站消息处理。
 * 这样按钮点击复用整套策略/会话/命令链路，而不是为卡片单独写一套逻辑。
 */
/**
 * 构造卡片按钮 value（编码命令 + 路由上下文）。
 * 用法：按钮点击后 value 会原样回到 onCardAction，用 parseCardCommandValue 解码。
 */
function cardCommandValue(command, opts = {}) {
    const value = { command };
    if (opts.chatType)
        value.chat_type = opts.chatType;
    if (opts.userId && opts.userId.trim() !== "")
        value.user_id = opts.userId.trim();
    return value;
}
/**
 * 解码卡片回调的 value。
 * 兼容三种形态：
 *  1. 本协议编码的对象 { command, chat_type, user_id }
 *  2. 纯字符串（旧式：直接当文本）
 *  3. 其他对象（无 command 字段 → 返回 null，调用方按普通文本处理）
 */
function parseCardCommandValue(value) {
    if (value == null)
        return null;
    if (typeof value === "string") {
        return value.trim() !== "" ? { command: value.trim() } : null;
    }
    const command = typeof value.command === "string" ? value.command.trim() : "";
    if (command === "")
        return null;
    const out = { command };
    const chatType = value.chat_type;
    if (chatType === "group" || chatType === "private")
        out.chat_type = chatType;
    if (typeof value.user_id === "string" && value.user_id.trim() !== "") {
        out.user_id = value.user_id.trim();
    }
    return out;
}
/**
 * 结构化卡片构造 —— 参考 Reasonix approvalCard/askCard。
 * 一个 markdown 正文 + 一行按钮的简单交互卡片。
 */
function actionCard(opts) {
    const elements = [];
    if (opts.buttons && opts.buttons.length > 0) {
        const buttons = opts.buttons.map((b) => {
            const base = {
                tag: "button",
                text: b.text,
                ...(b.type ? { type: b.type } : {}),
            };
            if ("command" in b) {
                base.value = cardCommandValue(b.command, {
                    ...(opts.chatType ? { chatType: opts.chatType } : {}),
                    ...(opts.userId ? { userId: opts.userId } : {}),
                });
            }
            else if (b.value) {
                base.value = b.value;
            }
            return base;
        });
        elements.push(...buttons);
    }
    return {
        ...(opts.header ? { header: opts.header } : {}),
        ...(opts.markdown ? { markdown: opts.markdown } : {}),
        elements,
    };
}

exports.ChatPlatformClient = ChatPlatformClient;
exports.ChatPlatformError = ChatPlatformError;
exports.ChatPlatformRegistry = ChatPlatformRegistry;
exports.FEISHU_EMOJI_KEYS = FEISHU_EMOJI_KEYS;
exports.PolicyChecker = PolicyChecker;
exports.actionCard = actionCard;
exports.cardCommandValue = cardCommandValue;
exports.createPolicyChecker = createPolicyChecker;
exports.defaultPolicy = defaultPolicy;
exports.defaultRegistry = defaultRegistry;
exports.feishuProvider = feishuProvider;
exports.parseCardCommandValue = parseCardCommandValue;
exports.registerFeishuPlatform = registerFeishuPlatform;
exports.registerPlatform = registerPlatform;
exports.toChatPlatformError = toChatPlatformError;
exports.validateFeishuConfig = validateFeishuConfig;
exports.validateFeishuEmoji = validateFeishuEmoji;
exports.validatePolicy = validatePolicy;
