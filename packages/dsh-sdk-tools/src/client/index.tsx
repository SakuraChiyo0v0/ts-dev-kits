/**
 * dsh-sdk-tools 设置页入口(client 半):在 DSH 设置里注册「SDK工具」section,
 * 提供 6 个功能包的 enabled 开关,读写 host 的 `dsh-sdk-tools` settings
 * namespace——切换即写 settings 文档,host 侧 watch 实时重注册工具。
 *
 * 只通过 cordis service(slots / settingsScope)协作,不 import 任何
 * @deepseek-ai 运行时值(全部 type-only,构建期擦除),client bundle 仅
 * external react / cordis。
 */

import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { SettingsPage, setSettingsScope, type SettingsShape } from "./settings-page.tsx";

/** 必需 service:slots(设置 section 注册)与 settingsScope(设置读写)。 */
export const inject = ["slots", "settingsScope"];

/** settings namespace,与 host 侧 src/settings.ts 保持一致(client 不 import host 代码)。 */
export const SETTINGS_NS = "dsh-sdk-tools";

/**
 * 注册设置页入口。scope 绑定挂在当前 fiber 上(fiber dispose 即清理),
 * slot 注册由 slots.inject 随 fiber 生命周期注销。
 * @param ctx - browser 插件上下文。
 */
export function apply(ctx: ClientContext): void {
  setSettingsScope(ctx.settingsScope.bind<SettingsShape>({ namespace: SETTINGS_NS }));
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "ts-dev-kits",
    order: 20,
    label: () => "SDK工具",
  }, SettingsPage));
}
