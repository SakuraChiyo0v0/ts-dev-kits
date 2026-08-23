/**
 * @sakurachiyo0v0/dsh-sdk-tools — DSH host 插件:把 ts-dev-kits 功能包
 * (bilibili / netease-music / ffmpeg / email / lol / vrchat)包装成 agent 工具。
 *
 * 通过 Agent 预设使用:预设的 agent.cordis.yml 声明本插件行后,工具注册
 * 落在该预设的 scope 层,只有选中该预设的会话才看得到;不选 = 完全不注册。
 *
 * 本插件只注册工具与 system prompt section,不发布任何 service,
 * 满足 agent-presets 对预设行的 leakedServices 检查。
 * @module @sakurachiyo0v0/dsh-sdk-tools
 */

import type { Context } from "@deepseek-ai/cordis";
import { Config } from "./config.js";
import type { Config as ConfigSchema, ResolvedConfig } from "./config.js";
import { registerCapabilities } from "./capabilities.js";

/** Cordis 插件名(loader 诊断用)。 */
export const name = "dsh-sdk-tools";

/** 必需 service:工具注册依赖 tools。 */
export const inject = ["tools"];

/** 插件配置 schema(未填项取默认)。 */
export { Config };
export type { ConfigSchema };

/** 应用插件:按 config 注册各功能包工具。 */
export function apply(ctx: Context, config: ConfigSchema): void {
  // schemastery (Config) 已填充所有默认值。
  registerCapabilities(ctx, config as ResolvedConfig);
}
