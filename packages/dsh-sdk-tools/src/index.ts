/**
 * @sakurachiyo0v0/dsh-sdk-tools — DSH host 插件:把 ts-dev-kits 功能包
 * (bilibili / netease-music / ffmpeg / email / lol / vrchat / kazumi)包装成 agent 工具。
 *
 * 通过 Agent 预设使用:预设的 agent.cordis.yml 声明本插件行后,工具注册
 * 落在该预设的 scope 层,只有选中该预设的会话才看得到;不选 = 完全不注册。
 *
 * 工具开关双通道:预设 entry 配置(agent.cordis.yml)提供 base 值与各包参数,
 * DSH 设置里的「SDK工具」页(settings 文档 `dsh-sdk-tools` 节)提供 user 层
 * enabled 覆盖——设置页切换实时生效,无需改 YAML、无需重启会话。
 *
 * 本插件只注册工具与 system prompt section,不发布任何 service,
 * 满足 agent-presets 对预设行的 leakedServices 检查。
 * @module @sakurachiyo0v0/dsh-sdk-tools
 */

import type { Context } from "@deepseek-ai/cordis";
import { Config } from "./config.js";
import type { Config as ConfigSchema, ResolvedConfig } from "./config.js";
import { registerCapabilities } from "./capabilities.js";
import { installSettings } from "./settings.js";

/** Cordis 插件名(loader 诊断用)。 */
export const name = "dsh-sdk-tools";

/** 必需 service:工具注册依赖 tools。 */
export const inject = ["tools"];

/** 插件配置 schema(未填项取默认)。 */
export { Config };
export type { ConfigSchema };

/** 应用插件:按 config 注册各功能包工具,并接线设置页开关的实时重注册。 */
export function apply(ctx: Context, config: ConfigSchema): void {
  // schemastery (Config) 已填充所有默认值。
  const resolved = config as ResolvedConfig;
  let disposeTools: (() => void) | undefined;
  const sync = (next: ResolvedConfig): void => {
    disposeTools?.();
    disposeTools = registerCapabilities(ctx, next);
  };
  // 初始:settings 未就绪/不存在时按 entry 配置注册(与旧行为一致)。
  sync(resolved);
  // settings 就绪后以文档覆盖 enabled,变化时经 sync 实时重注册。
  installSettings(ctx, resolved, sync);
}
