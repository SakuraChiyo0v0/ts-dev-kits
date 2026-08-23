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
 */
export function registerCapabilities(ctx: Context, config: ResolvedConfig): void {
  if (config.bilibili.enabled) {
    applyBilibiliTools(ctx, config.bilibili);
  }
  if (config.netease.enabled) {
    applyNeteaseTools(ctx, config.netease);
  }
  if (config.ffmpeg.enabled) {
    applyFfmpegTools(ctx, config.ffmpeg);
  }
  if (config.email.enabled) {
    applyEmailTools(ctx, config.email);
  }
  if (config.lol.enabled) {
    applyLolTools(ctx, config.lol);
  }
  if (config.vrchat.enabled) {
    applyVrchatTools(ctx, config.vrchat);
  }
}
