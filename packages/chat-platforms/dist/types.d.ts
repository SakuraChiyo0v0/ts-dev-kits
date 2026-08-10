/**
 * 统一聊天平台消息模型。
 * 平台差异（飞书/Telegram/微信…）在适配器内消化，上层只面对本模型。
 */
/** 会话类型：私聊 / 群聊 */
export type ChatMessageType = "private" | "group";
/**
 * 会话来源 —— 定位"这条消息来自哪个平台的哪个会话"。
 * 与平台无关，用于 session 隔离与跨平台手递。
 */
export interface ChatSource {
    /** 平台 id，如 "feishu" */
    platform: string;
    /** 会话 id：私聊为对方用户 id，群聊为群 id */
    chatId: string;
    /** 消息类型 */
    type: ChatMessageType;
    /** 发送者用户 id（平台内唯一） */
    userId?: string;
    /** 发送者昵称 */
    userName?: string;
    /** 是否为管理员/机器人主人 */
    isAdmin?: boolean;
    /** 群聊时所在群的标题 */
    groupName?: string;
    /** 群聊中是否 @ 了机器人（飞书 mentions 命中机器人） */
    mentionedBot?: boolean;
}
/** 入站消息（平台事件归一化后） */
export interface ChatMessage {
    /** 平台侧消息 id（用于去重） */
    messageId: string;
    source: ChatSource;
    /** 纯文本内容（富文本/卡片消息取可读文本） */
    text: string;
    /** 原始平台事件（保留供适配器专用逻辑使用） */
    raw?: unknown;
    /** 被回复消息的 id（若有） */
    replyToMessageId?: string;
}
/** 出站消息（发送回复/主动推送的统一形态） */
export interface ChatMessageOutbound {
    text: string;
    /** 被回复的消息 id（可选） */
    replyToMessageId?: string;
}
/** 发送结果 */
export interface ChatSendResult {
    platform: string;
    messageId: string;
    /** 是否成功 */
    ok: boolean;
}
/** 卡片按钮（点击触发 card.action.trigger 回调） */
export interface ChatCardButton {
    tag: "button";
    text: string;
    /** 按钮样式 */
    type?: "default" | "primary" | "danger";
    /** 回调时原样带回的 value */
    value?: Record<string, unknown>;
    /** 跳转链接（有则点击跳转而非回调） */
    url?: string;
}
/** 卡片下拉菜单项 */
export interface ChatCardSelectOption {
    text: string;
    value: string;
}
/** 卡片下拉菜单 */
export interface ChatCardSelect {
    tag: "select";
    placeholder?: string;
    options: ChatCardSelectOption[];
    /** 回调时带回的 name（区分是哪个菜单） */
    name?: string;
}
/** 交互卡片元素（按钮/菜单） */
export type ChatCardElement = ChatCardButton | ChatCardSelect;
/** 交互卡片（平台无关的抽象，飞书/微信等适配器各自转换） */
export interface ChatCard {
    /** 卡片标题 */
    header?: string;
    /** 卡片主题色 */
    headerColor?: string;
    /** 卡片正文（markdown） */
    markdown?: string;
    /** 交互元素（按钮/菜单） */
    elements: ChatCardElement[];
}
/** 卡片按钮/菜单点击回调（card.action.trigger 归一化） */
export interface ChatCardAction {
    /** 平台 id */
    platform: string;
    /** 会话来源（操作者所在会话） */
    source: ChatSource;
    /** 操作者 userId */
    operatorId: string;
    /** 按钮 value（按钮 value 或 select name+option） */
    value: Record<string, unknown> | string;
    /** 原始平台事件 */
    raw?: unknown;
}
/** 出站消息（发送回复/主动推送的统一形态） */
export interface ChatMessageOutbound {
    text: string;
    /** 被回复的消息 id（可选） */
    replyToMessageId?: string;
    /** 交互卡片（可选，发送卡片消息而非纯文本） */
    card?: ChatCard;
}
/** 平台适配器统一接口。每个平台一个实现，注册到 registry。 */
export interface ChatPlatformAdapter {
    readonly name: string;
    /** 平台能力特性声明，让上层按能力而非平台名分支 */
    readonly capabilities: ChatPlatformCapabilities;
    /**
     * 建立连接并开始接收消息。
     * 收到消息后调用 onMessage 回调（由上层注入）。
     * 卡片按钮/菜单点击时调用 onCardAction 回调（由上层注入）。
     * 返回的 Promise 在连接被主动断开时 resolve。
     */
    connect(options: {
        onMessage: (message: ChatMessage) => void | Promise<void>;
        onCardAction?: (action: ChatCardAction) => void | Promise<void>;
    }): Promise<void>;
    /** 断开连接，停止接收消息 */
    disconnect(): Promise<void>;
    /** 发送一条消息到指定会话（可带交互卡片） */
    send(source: ChatSource, message: ChatMessageOutbound): Promise<ChatSendResult>;
    /**
     * 可选：webhook 模式的入站入口。
     * 外部 HTTP 服务收到平台回调后调用此方法，返回平台要求的应答（如 challenge）。
     */
    handleWebhook?(body: string): Promise<{
        challenge?: string;
        ok: boolean;
    }>;
    /**
     * 可选：表情回应（对消息加表情反馈）。
     * 不支持表情的平台可不实现。
     */
    react?(message: ChatMessage, emoji: string): Promise<void>;
}
/** 平台能力特性（参考 hermes BasePlatformAdapter 的能力声明模式） */
export interface ChatPlatformCapabilities {
    /** 是否支持发送富文本/卡片 */
    supportsRichText: boolean;
    /** 是否支持发送图片 */
    supportsImages: boolean;
    /** 平台是否自动拆分长消息 */
    splitsLongMessages: boolean;
}
/** 适配器创建工厂：接收配置，返回适配器实例 */
export type ChatPlatformFactory<TOptions = unknown> = (options: TOptions) => ChatPlatformAdapter;
/** 注册表条目 */
export interface ChatPlatformEntry<TOptions = unknown> {
    /** 平台 id，如 "feishu" */
    id: string;
    label: string;
    /** 创建适配器 */
    create: ChatPlatformFactory<TOptions>;
    /** 配置校验，返回错误信息（null 表示通过） */
    validateConfig?: (config: unknown) => string | null;
}
