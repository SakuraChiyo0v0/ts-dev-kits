/**
 * 规则远端同步 —— 经 @sakurachiyo0v0/config 的 namespace('kazumi') 存 WebDAV。
 *
 * 设计:
 *   - namespace 默认加密存储(config center 约定:上 WebDAV 的数据一律加密,
 *     云端 `/amechan/secrets/kazumi/`),规则 JSON 非敏感但加密无害。
 *   - 本地文件系统是缓存/离线副本;远端 namespace 是权威(多端同步)。
 *   - add/remove 本地 + 远端双写;list/get 优先远端,远端不可用(无全局
 *     配置/未 setup/网络失败)时回退本地。
 *   - 同步按需开启(createAnimeClient 的 sync: true),默认关闭——避免
 *     无全局配置的环境(CI/测试)强制要求 WebDAV。
 */
import { createLogger } from "@sakurachiyo0v0/logger";
import { createWebdavConfigCenter, type ConfigCenter, type ConfigNamespace } from "@sakurachiyo0v0/config";
import { KazumiError } from "../errors.js";

const logger = createLogger({ namespace: "kazumi" }).child("sync");

/** 规则远端同步层。 */
export class RuleSync {
  private readonly ns: ConfigNamespace | null;

  constructor(
    sync: boolean,
    /** 可注入配置中心(测试用);缺省读本地全局配置走 WebDAV。 */
    center?: ConfigCenter,
  ) {
    if (!sync) {
      this.ns = null;
      return;
    }
    try {
      const configCenter = center ?? createWebdavConfigCenter();
      this.ns = configCenter.namespace("kazumi");
    } catch (error) {
      // 全局配置未 setup 时,同步不可用(不阻塞本地使用)。
      logger.warn("WebDAV 规则同步不可用(全局配置未配置),回退本地规则目录", {
        error: String(error),
      });
      this.ns = null;
    }
  }

  get enabled(): boolean {
    return this.ns !== null;
  }

  /** 列出远端规则名(同步不可用时返回空数组)。 */
  async list(): Promise<string[]> {
    if (this.ns === null) return [];
    try {
      return await this.ns.list();
    } catch (error) {
      logger.warn("远端规则列表读取失败,回退本地", { error: String(error) });
      return [];
    }
  }

  /** 读取远端规则 JSON(不存在或失败返回 null)。 */
  async get(name: string): Promise<Record<string, unknown> | null> {
    if (this.ns === null) return null;
    try {
      return await this.ns.get<Record<string, unknown>>(name);
    } catch (error) {
      if (error instanceof KazumiError) throw error;
      logger.warn(`远端规则 ${name} 读取失败,回退本地`, { error: String(error) });
      return null;
    }
  }

  /** 写入远端规则(失败不抛,记录日志——本地仍可用)。 */
  async put(name: string, json: Record<string, unknown>): Promise<void> {
    if (this.ns === null) return;
    try {
      await this.ns.set(name, json);
      logger.info(`远端规则已写入: ${name}`);
    } catch (error) {
      logger.warn(`远端规则 ${name} 写入失败(本地已保存)`, { error: String(error) });
    }
  }

  /** 删除远端规则(失败不抛)。 */
  async remove(name: string): Promise<void> {
    if (this.ns === null) return;
    try {
      await this.ns.remove(name);
      logger.info(`远端规则已删除: ${name}`);
    } catch (error) {
      logger.warn(`远端规则 ${name} 删除失败(本地已删除)`, { error: String(error) });
    }
  }
}
