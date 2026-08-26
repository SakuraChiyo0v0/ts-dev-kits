import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import type { ResolvedConfig } from "./config.js";

/**
 * dsh-sdk-tools 的用户设置接线。
 *
 * settings 文档(`~/.dsh/settings.yaml` 的 `dsh-sdk-tools` 节)只承载 6 个
 * 扁平 enabled 开关——设置页只开关"用不用这个功能包",各包参数
 * (outputDir / level / smtp 等)仍由预设 entry 配置提供,避免敏感字段
 * (SMTP 密码)进入设置文档的 redacted 视图后被整节重写误删。
 *
 * 分层:entry 配置(agent.cordis.yml)作为 base 层,settings 文档作为
 * user 层;resolved = schema 默认 → base → user。开关在设置页切换后
 * 立即覆盖 entry 值,host 侧通过 watch 实时重注册工具。
 */

/** 本插件 settings namespace(小写 kebab-case,与包名同形)。 */
export const SETTINGS_NS = settingsNamespace("dsh-sdk-tools");

/** settings 文档里的扁平开关输入(schemastery 校验前,字段可省略)。 */
export interface SettingsShapeInput {
  bilibili?: boolean;
  netease?: boolean;
  ffmpeg?: boolean;
  email?: boolean;
  lol?: boolean;
  vrchat?: boolean;
  logs?: boolean;
}

/** settings 文档里的扁平开关形状(schema 填充默认后)。 */
export interface SettingsShape {
  bilibili: boolean;
  netease: boolean;
  ffmpeg: boolean;
  email: boolean;
  lol: boolean;
  vrchat: boolean;
  logs: boolean;
}

/** settings namespace 的 schema:与预设 entry 的默认 enabled 保持一致。 */
export const SettingsSchema: z<SettingsShapeInput> = z.object({
  bilibili: z.boolean().default(true),
  netease: z.boolean().default(true),
  ffmpeg: z.boolean().default(true),
  email: z.boolean().default(false),
  lol: z.boolean().default(true),
  vrchat: z.boolean().default(false),
  logs: z.boolean().default(true),
});

/** 嵌套 entry config → 扁平 settings 形状(installSettingsSection 的 base 层)。 */
export function toSettingsShape(config: ResolvedConfig): SettingsShape {
  return {
    bilibili: config.bilibili.enabled,
    netease: config.netease.enabled,
    ffmpeg: config.ffmpeg.enabled,
    email: config.email.enabled,
    lol: config.lol.enabled,
    vrchat: config.vrchat.enabled,
    logs: config.logs.enabled,
  };
}

/** 扁平 settings 值 → 完整内部 config;未涉及的字段继承 entry config。 */
export function applySettingsShape(config: ResolvedConfig, shape: SettingsShapeInput): ResolvedConfig {
  return {
    ...config,
    bilibili: { ...config.bilibili, enabled: shape.bilibili ?? config.bilibili.enabled },
    netease: { ...config.netease, enabled: shape.netease ?? config.netease.enabled },
    ffmpeg: { ...config.ffmpeg, enabled: shape.ffmpeg ?? config.ffmpeg.enabled },
    email: { ...config.email, enabled: shape.email ?? config.email.enabled },
    lol: { ...config.lol, enabled: shape.lol ?? config.lol.enabled },
    vrchat: { ...config.vrchat, enabled: shape.vrchat ?? config.vrchat.enabled },
    logs: { ...config.logs, enabled: shape.logs ?? config.logs.enabled },
  };
}

/**
 * 安装 settings 接线:settings service 存在时注册 namespace 并以 entry
 * 配置为 base,变化时经 `sync` 重新注册/注销工具;service 不存在或
 * 卸载时回退 entry 配置。
 * @param ctx - 插件上下文。
 * @param entry - 预设 entry 配置(agent.cordis.yml 的 config)。
 * @param sync - 按当前生效配置重新注册工具的同步函数。
 */
export function installSettings(ctx: Context, entry: ResolvedConfig, sync: (next: ResolvedConfig) => void): void {
  let active: () => ResolvedConfig = () => entry;
  installSettingsSection(ctx, SETTINGS_NS, SettingsSchema, toSettingsShape(entry), {
    setSource(current) {
      active = () => applySettingsShape(entry, current());
    },
    onChange() {
      sync(active());
    },
  });
}
