export { ChatPlatformClient } from "./client.js";
export { ChatPlatformError, toChatPlatformError, type ChatPlatformErrorCode, } from "./errors.js";
export { ChatPlatformRegistry, defaultRegistry, registerPlatform } from "./registry.js";
export { feishuProvider } from "./providers/feishu/index.js";
export { registerFeishuPlatform, validateFeishuConfig, } from "./providers/feishu/index.js";
export type { FeishuConfig } from "./providers/feishu/index.js";
export type { ChatMessage, ChatMessageOutbound, ChatMessageType, ChatPlatformAdapter, ChatPlatformCapabilities, ChatPlatformEntry, ChatPlatformFactory, ChatSendResult, ChatSource, } from "./types.js";
