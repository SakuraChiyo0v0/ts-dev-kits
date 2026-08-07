import type { ChatPlatformAdapter } from "../../types.js";
import { type FeishuConfig } from "./feishu-types.js";
/**
 * 飞书适配器。
 * 入站：im.message.receive_v1 事件（长连接或 webhook 均可）→ 归一化 ChatMessage。
 * 出站：im.message.create 发新消息；im.message.reply 回复指定消息。
 */
export declare function feishuProvider(config: FeishuConfig): ChatPlatformAdapter;
