/**
 * 弹幕 API:发送视频弹幕、获取弹幕列表。
 *
 * 协议对照 bilibili-API-collect docs/danmaku/:
 *   - 发送弹幕:     POST /x/v2/dm/post(WBI 签名 URL + form body)
 *   - 获取弹幕:     GET  /x/v1/dm/list.so?oid={cid}(XML,protover=0)
 *
 * 发送弹幕要求 WBI 签名(w_rid/wts 放 URL),body 为 form 表单,csrf 注入。
 */
import type { ApiSession } from "../network.js";

/** 弹幕类型。 */
export enum DanmakuMode {
  /** 普通滚动弹幕。 */
  Normal = 1,
  /** 底部弹幕。 */
  Bottom = 4,
  /** 顶部弹幕。 */
  Top = 5,
  /** 高级弹幕。 */
  Advanced = 7,
  /** BAS 弹幕(pool 必须为 2)。 */
  Bas = 9,
}

/** 一条弹幕。 */
export interface DanmakuItem {
  /** 出现时间(秒)。 */
  time: number;
  mode: number;
  /** 十进制 RGB888 颜色。 */
  color: number;
  /** 用户 mid(可能为空)。 */
  mid?: string;
  text: string;
}

/** 弹幕 API。 */
export class DanmakuApi {
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  /**
   * 发送弹幕到视频。
   * @param cid 视频分P cid
   * @param msg 弹幕内容(≤100 字符)
   * @param options.progress 弹幕出现时间(毫秒,默认 0)
   * @param options.aidOrBvid 稿件 aid 或 bvid(二选一)
   * @param options.color 弹幕颜色(十进制 RGB888,如 16777215 白色)
   * @param options.mode 弹幕类型(默认普通滚动)
   * @param options.pool 弹幕池(0 普通,1 字幕,2 特殊)
   * @param options.fontsize 字号(默认 25)
   */
  async send(
    cid: number | string,
    msg: string,
    options: {
      progress?: number;
      aidOrBvid?: number | string;
      color?: number;
      mode?: DanmakuMode;
      pool?: 0 | 1 | 2;
      fontsize?: number;
    } = {},
  ): Promise<void> {
    const body: Record<string, string | number> = {
      type: 1,
      oid: Number(cid),
      msg,
      mode: options.mode ?? DanmakuMode.Normal,
      ...(options.progress !== undefined ? { progress: options.progress } : {}),
      ...(options.aidOrBvid !== undefined
        ? isNumeric(options.aidOrBvid)
          ? { aid: Number(options.aidOrBvid) }
          : { bvid: String(options.aidOrBvid) }
        : {}),
      ...(options.color !== undefined ? { color: options.color } : {}),
      ...(options.pool !== undefined ? { pool: options.pool } : {}),
      ...(options.fontsize !== undefined ? { fontsize: options.fontsize } : {}),
    };
    await this.#session.postWbi(`${this.#session.baseUrl}/x/v2/dm/post`, body);
  }

  /**
   * 获取视频弹幕列表。
   * @param cid 视频分P cid
   * @param segment 分段索引(0 为前 6 分钟,之后每 6 分钟一段),可选
   */
  async list(cid: number | string, segment = 0): Promise<DanmakuItem[]> {
    const url = `${this.#session.baseUrl}/x/v1/dm/list.so?oid=${encodeURIComponent(String(cid))}${
      segment > 0 ? `&segment=${segment}` : ""
    }`;
    const text = await this.#session.getRawText(url);
    return parseDanmakuXml(text);
  }
}

/** 判断是否为纯数字(avid)。 */
function isNumeric(value: number | string): boolean {
  return /^\d+$/u.test(String(value));
}

/** 解析弹幕 XML(<d p="time,mode,size,color,ctime,pool,uid,rowid">text</d>)。 */
export function parseDanmakuXml(xml: string): DanmakuItem[] {
  const items: DanmakuItem[] = [];
  const regex = /<d\s+p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const attrs = (match[1] ?? "").split(",");
    const text = (match[2] ?? "").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&").replace(/&quot;/gu, '"');
    const item: DanmakuItem = {
      time: Number(attrs[0] ?? 0),
      mode: Number(attrs[1] ?? 1),
      color: Number(attrs[3] ?? 16777215),
      text,
    };
    const uid = attrs[6];
    if (uid !== undefined && uid !== "") {
      item.mid = uid;
    }
    items.push(item);
  }
  return items;
}
