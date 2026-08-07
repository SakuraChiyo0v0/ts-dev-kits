import type { ChatPlatformErrorCode } from "../../errors.js";

/** 飞书应用配置 */
export interface FeishuConfig {
  /** 应用 App ID，如 cli_xxx */
  appId: string;
  /** 应用 App Secret */
  appSecret: string;
  /** 事件接收方式：长连接（默认）或 webhook 回调 */
  transport: "websocket" | "webhook";
  /**
   * webhook 模式必填：事件订阅的回调地址（含验签配置）。
   * verificationToken / encryptKey 用于飞书回调验签与解密。
   */
  verificationToken?: string;
  encryptKey?: string;
  /** 私聊是否也响应（默认 true）；false 时只处理群聊 @ 机器人 */
  enablePrivateChat?: boolean;
}

/** 事件处理错误码映射（飞书错误码 → 统一错误码） */
const FEISHU_ERROR_MAP: Readonly<Record<number, ChatPlatformErrorCode>> = {
  99991663: "AUTHENTICATION", // 租户访问令牌无效
  99991664: "AUTHENTICATION", // 无效访问令牌
  230002: "AUTHENTICATION", // 没有权限
  230001: "NOT_FOUND", // 群不存在
  230005: "NOT_FOUND", // 群不存在
  230101: "VALIDATION", // 消息内容格式错误
};

/** 归一化飞书错误码 */
export function feishuErrorCode(code: number): ChatPlatformErrorCode {
  // 230000-230099 段多为用户/群/消息不存在类错误
  if (code >= 230000 && code < 230100) {
    return "NOT_FOUND";
  }
  return FEISHU_ERROR_MAP[code] ?? "UNKNOWN";
}

/** 校验配置，返回错误信息（null 表示通过） */
export function validateFeishuConfig(config: unknown): string | null {
  if (typeof config !== "object" || config === null) {
    return "飞书配置必须是对象";
  }
  const c = config as Partial<FeishuConfig>;
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
