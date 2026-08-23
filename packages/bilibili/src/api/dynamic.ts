/**
 * 动态 API:发布纯文本动态、删除动态、置顶/取消置顶、转发动态。
 *
 * 说明:动态点赞/取消赞属于刷量重灾区操作,本 SDK 不予提供(见 interaction.ts 说明)。
 *
 * 协议对照 bilibili-API-collect docs/dynamic/:
 *   - 发布纯文本动态: POST {vcBaseUrl}/dynamic_svr/v1/dynamic_svr/create { dynamic_id:0, type:4, rid:0, content, ... }
 *   - 删除动态:       POST {vcBaseUrl}/dynamic_svr/v1/dynamic_svr/rm_dynamic { dynamic_id }
 *   - 转发动态:       POST {vcBaseUrl}/dynamic_repost/v1/dynamic_repost/repost { dynamic_id, content? }
 *   - 置顶/取消置顶:  POST /x/dynamic/feed/space/set_top|rm_top(csrf 在 URL,body JSON { dyn_str })
 */
import { BilibiliError } from "../errors.js";
import type { ApiSession } from "../network.js";

/** 动态 API。 */
export class DynamicApi {
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  /**
   * 发布纯文本动态,返回动态 id。
   * @param content 动态正文
   * @param options.atUids 提及的用户 mid 列表
   * @param options.upCloseComment 是否关闭评论区
   */
  async createText(
    content: string,
    options: { atUids?: string[]; upCloseComment?: boolean } = {},
  ): Promise<string> {
    if (content.trim() === "") {
      throw new BilibiliError("API_ERROR", "Dynamic content must not be empty");
    }
    const data = await this.#session.postJson<{ dynamic_id_str?: string }>(
      `${this.#session.vcBaseUrl}/dynamic_svr/v1/dynamic_svr/create`,
      {
        dynamic_id: 0,
        type: 4,
        rid: 0,
        content,
        ...(options.atUids !== undefined && options.atUids.length > 0
          ? { at_uids: options.atUids.join(",") }
          : {}),
        ...(options.upCloseComment !== undefined
          ? { up_close_comment: options.upCloseComment ? 1 : 0 }
          : {}),
      },
    );
    const id = data.dynamic_id_str;
    if (id === undefined || id === "") {
      throw new BilibiliError("API_ERROR", "dynamic_svr/create response missing dynamic_id_str", {
        cause: data,
      });
    }
    return id;
  }

  /** 删除自己的动态。 */
  async del(dynamicId: number | string): Promise<void> {
    await this.#session.postJson(
      `${this.#session.vcBaseUrl}/dynamic_svr/v1/dynamic_svr/rm_dynamic`,
      { dynamic_id: Number(dynamicId) },
    );
  }

  /** 转发动态,返回新动态 id。 */
  async repost(
    dynamicId: string,
    options: { content?: string } = {},
  ): Promise<string> {
    const data = await this.#session.postJson<{ dynamic_id_str?: string }>(
      `${this.#session.vcBaseUrl}/dynamic_repost/v1/dynamic_repost/repost`,
      {
        dynamic_id: Number(dynamicId),
        ...(options.content !== undefined && options.content !== ""
          ? { content: options.content }
          : {}),
      },
    );
    const id = data.dynamic_id_str;
    if (id === undefined || id === "") {
      throw new BilibiliError("API_ERROR", "dynamic_repost/repost response missing dynamic_id_str", {
        cause: data,
      });
    }
    return id;
  }

  /** 置顶动态。 */
  async pin(dynamicId: string): Promise<void> {
    await this.#session.postJson(
      `${this.#session.baseUrl}/x/dynamic/feed/space/set_top`,
      { dyn_str: dynamicId },
      { csrfInQuery: true },
    );
  }

  /** 取消置顶动态。 */
  async unpin(dynamicId: string): Promise<void> {
    await this.#session.postJson(
      `${this.#session.baseUrl}/x/dynamic/feed/space/rm_top`,
      { dyn_str: dynamicId },
      { csrfInQuery: true },
    );
  }
}
