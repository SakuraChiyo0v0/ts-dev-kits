/**
 * 下载管理器：按平台隔离的 DownloadManager 单例。
 * 每平台一个实例，历史记录写到独立文件 .download-state-<platform>.json，互不干扰。
 */
import { DownloadManager } from "@sakurachiyo0v0/media-downloader";

export type DownloadPlatform = "netease-music" | "bilibili" | "kazumi";

const managers = new Map<DownloadPlatform, DownloadManager>();

/** 获取指定平台的下载管理器（历史记录按平台隔离）。 */
export function getDownloadManager(platform: DownloadPlatform = "netease-music"): DownloadManager {
  let mgr = managers.get(platform);
  if (mgr === undefined) {
    const root = process.env.DOWNLOAD_DIR ?? "/downloads";
    mgr = new DownloadManager({
      root,
      stateFile: `${root}/.download-state-${platform}.json`,
    });
    managers.set(platform, mgr);
  }
  return mgr;
}

/** 下载根目录（供各路由构造最终输出目录）。 */
export function downloadRoot(): string {
  return process.env.DOWNLOAD_DIR ?? "/downloads";
}
