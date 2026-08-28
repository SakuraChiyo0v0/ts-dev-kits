/**
 * 平台 → 扫码登录适配器映射。
 * 本阶段只支持 netease-music；后续接入新平台时在此扩展。
 */
import type { QrLoginAdapter } from "@sakurachiyo0v0/account";
import { neteaseQrAdapter } from "@sakurachiyo0v0/netease-music";

export const SUPPORTED_PLATFORMS = ["netease-music"] as const;

export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

export function isSupportedPlatform(value: string): value is SupportedPlatform {
  return (SUPPORTED_PLATFORMS as readonly string[]).includes(value);
}

export function getAuthAdapter(platform: SupportedPlatform): QrLoginAdapter {
  switch (platform) {
    case "netease-music":
      return neteaseQrAdapter();
  }
}
