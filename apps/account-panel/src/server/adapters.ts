/**
 * 平台 → 扫码登录适配器映射。
 * 已支持 netease-music / bilibili；后续接入新平台时在此扩展。
 */
import type { QrLoginAdapter } from "@sakurachiyo0v0/account";
import { neteaseQrAdapter } from "@sakurachiyo0v0/netease-music";
import { bilibiliQrAdapter } from "@sakurachiyo0v0/bilibili";

export const SUPPORTED_PLATFORMS = ["netease-music", "bilibili"] as const;

export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

export function isSupportedPlatform(value: string): value is SupportedPlatform {
  return (SUPPORTED_PLATFORMS as readonly string[]).includes(value);
}

export function getAuthAdapter(platform: SupportedPlatform): QrLoginAdapter {
  switch (platform) {
    case "netease-music":
      return neteaseQrAdapter();
    case "bilibili":
      return bilibiliQrAdapter();
  }
}
