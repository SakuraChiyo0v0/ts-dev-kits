import type { Context } from "@deepseek-ai/cordis";
import type { ResolvedConfig } from "./config.js";
import { applyBilibiliTools } from "./tools/bilibili.js";
import { applyNeteaseTools } from "./tools/netease.js";
import { applyFfmpegTools } from "./tools/ffmpeg.js";
import { applyEmailTools } from "./tools/email.js";
import { applyLolTools } from "./tools/lol.js";
import { applyVrchatTools } from "./tools/vrchat.js";

/**
 * 按 config 的 enabled 开关注册各功能包工具。
 * 未启用的包完全不注册 → 不进 system prompt → 0 token 开销。
 *
 * 返回 disposer:settings 变化重新评估时先 dispose 旧注册,再按新 enabled
 * 注册,实现设置页开关的实时生效。
 */
export function registerCapabilities(ctx: Context, config: ResolvedConfig): () => void {
  const disposers: Array<() => void> = [];
  if (config.bilibili.enabled) {
    disposers.push(applyBilibiliTools(ctx, config.bilibili));
  }
  if (config.netease.enabled) {
    disposers.push(applyNeteaseTools(ctx, config.netease));
  }
  if (config.ffmpeg.enabled) {
    disposers.push(applyFfmpegTools(ctx, config.ffmpeg));
  }
  if (config.email.enabled) {
    disposers.push(applyEmailTools(ctx, config.email));
  }
  if (config.lol.enabled) {
    disposers.push(applyLolTools(ctx, config.lol));
  }
  if (config.vrchat.enabled) {
    disposers.push(applyVrchatTools(ctx, config.vrchat));
  }
  return () => { for (const dispose of disposers) dispose(); };
}
