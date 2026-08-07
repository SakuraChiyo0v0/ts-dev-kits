import { registerPlatform } from "../../registry.js";
import { feishuProvider } from "./feishu-provider.js";
import { validateFeishuConfig } from "./feishu-types.js";
import type { FeishuConfig } from "./feishu-types.js";

export { feishuProvider } from "./feishu-provider.js";
export { FEISHU_EMOJI_KEYS, validateFeishuConfig, validateFeishuEmoji } from "./feishu-types.js";
export type { FeishuConfig } from "./feishu-types.js";

/** 向默认注册表注册飞书平台 */
export function registerFeishuPlatform(): void {
  registerPlatform({
    id: "feishu",
    label: "飞书",
    create: (config: FeishuConfig) => feishuProvider(config),
    validateConfig: validateFeishuConfig,
  });
}
