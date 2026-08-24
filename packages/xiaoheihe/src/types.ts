/**
 * 小黑盒 API 数据模型 —— 字段语义的权威定义。
 * 字段名/类型对照 Go 参考实现(xhh/*.go)与真实响应;userid 可能为数字或字符串,统一归一化为 number | string 并在此处理。
 */

// ---- 登录 ----

/** 扫码二维码响应 result。 */
export interface QrcodeResult {
  /** 完整二维码 URL(形如 https://api.xiaoheihe.cn/account/qr_login/?<params>)。 */
  qr_url: string;
  expire: number;
  error?: string;
  error_msg?: string;
  nickname?: string;
}

// ---- 会话 ----

/** 持久化登录态(与 account AuthStore 的 credentials 对齐)。 */
export interface XiaoheiheCredentials {
  /** 请求 Cookie 头(两个凭证 cookie + x_xhh_tokenid 拼接)。 */
  cookie: string;
  /** 登录用户 heybox_id(来自 user_heybox_id cookie)。 */
  heyboxId: string;
  /** 登录时刻 unix 秒(x_xhh_tokenid 内的盐值时间戳)。 */
  time: number;
}

// ---- 帖子 / 评论 ----

/** 单条评论。 */
export interface XiaoheiheComment {
  commentid: number;
  userid: number | string;
  text: string;
  replyid?: number;
  floor_num?: number;
  user?: { username?: string };
  imgs?: { url: string }[];
  replyuser?: { username?: string };
}

/** 帖子详情(link/tree 的 result.link)。 */
export interface XiaoheiheLink {
  linkid?: number;
  title: string;
  /** 正文(JSON 字符串,需经 parseLinkText 二次解析)。 */
  text: string;
  topics?: { name: string }[];
  hashtags?: { name: string }[];
  user?: { userid?: number | string; username?: string };
}

/** 帖子详情 + 评论区单页(link/tree)。 */
export interface LinkTreeResult {
  comments?: { comment: XiaoheiheComment[] }[];
  total_page?: number;
  has_more_floors?: number;
  link?: XiaoheiheLink;
}

/** 正文段落(link.text 解析产物)。 */
export interface TextDetail {
  text: string;
  type: string;
  url?: string;
}

/** 子评论翻页(sub/comments)。 */
export interface SubCommentsResult {
  has_more: boolean;
  lastval?: number;
  comments: XiaoheiheComment[];
}

// ---- Feed ----

/** 首页帖子流条目(feeds)。 */
export interface FeedLink {
  linkid: number;
  title: string;
  description?: string;
  topics?: { name: string }[];
  hashtags?: { name: string }[];
  user?: { userid?: number | string };
}

// ---- 消息 ----

/** @消息(user/message)。 */
export interface XiaoheiheMessage {
  comment_a_id?: number;
  comment_a_text?: string;
  message_id?: number;
  root_comment_id?: number;
  linkid?: number;
  userid_a?: number;
  /** 发帖召唤时顶层 linkid 为 0,从嵌套 link 抢救(Go 兼容逻辑)。 */
  link?: { linkid?: number; text?: string };
  user_a?: { username?: string; nickname?: string; name?: string };
  user?: { username?: string; nickname?: string; name?: string };
  nickname?: string;
  username?: string;
}

// ---- 用户 ----

/** 用户资料(user/profile)。 */
export interface XiaoheiheProfile {
  user?: { userid?: number | string; username?: string; nickname?: string };
}

// ---- 通用响应 ----

/** 服务端统一响应外壳。 */
export interface XiaoheiheResponse<T> {
  status: string;
  msg?: string;
  result?: T;
  version?: string;
}

/** 把 link.text 的 JSON 字符串解析为段落数组;解析失败降级为纯文本段落。 */
export function parseLinkText(text: string): TextDetail[] {
  if (text === "" || text === undefined || text === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const details: TextDetail[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const record = item as Record<string, unknown>;
      details.push({
        text: typeof record.text === "string" ? record.text : "",
        type: typeof record.type === "string" ? record.type : "text",
        ...(typeof record.url === "string" ? { url: record.url } : {}),
      });
    }
    return details;
  } catch {
    return [{ text, type: "text" }];
  }
}
