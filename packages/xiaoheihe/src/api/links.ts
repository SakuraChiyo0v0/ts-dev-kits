/**
 * 帖子与评论查询域 —— /bbs/app/link/tree(帖子详情+评论区)、/bbs/app/comment/sub/comments(子评论翻页)。
 */
import { XiaoheiheHttpTransport } from "../transport.js";
import {
  parseLinkText,
  type LinkTreeResult,
  type SubCommentsResult,
  type XiaoheiheResponse,
} from "../types.js";

export interface LinkTreeParams {
  /** 帖子 ID。 */
  linkId: number;
  /** 评论区分页,从 1 开始。 */
  page?: number;
  /** 每页条数,默认 20。 */
  limit?: number;
}

export interface SubCommentsParams {
  /** 根评论 ID。 */
  rootCommentId: number;
  /** 翻页游标(上次返回的 lastval)。 */
  lastval?: number;
}

/** 帖子详情解析产物(正文已解析为段落数组)。 */
export interface LinkDetail {
  linkId: number;
  title: string;
  /** 正文段落(text/image 等)。 */
  contents: { text: string; type: string; url?: string }[];
  /** 楼层分组评论(第 page 页)。 */
  comments: import("../types.js").XiaoheiheComment[];
  totalPage?: number;
  hasMoreFloors?: boolean;
  author?: { userid?: number | string; username?: string };
  topics?: { name: string }[];
  hashtags?: { name: string }[];
}

/** 帖子与评论查询域。 */
export class LinksApi {
  constructor(private readonly transport: XiaoheiheHttpTransport) {}

  /** 帖子详情 + 评论区单页。 */
  async getDetail(params: LinkTreeParams): Promise<LinkDetail> {
    const { linkId, page = 1, limit = 20 } = params;
    const body = await this.transport.request<XiaoheiheResponse<LinkTreeResult>>({
      path: "/bbs/app/link/tree",
      params: {
        h_src: "",
        link_id: linkId,
        page,
        is_first: page === 1 ? "1" : "0",
        index: 1,
        limit,
        owner_only: 0,
      },
    });
    const result = body.result;
    if (result === undefined) {
      return {
        linkId,
        title: "",
        contents: [],
        comments: [],
      };
    }
    const comments = result.comments?.flatMap((group) => group.comment) ?? [];
    return {
      linkId,
      title: result.link?.title ?? "",
      contents: parseLinkText(result.link?.text ?? ""),
      comments,
      ...(result.total_page !== undefined ? { totalPage: result.total_page } : {}),
      ...(result.has_more_floors !== undefined
        ? { hasMoreFloors: result.has_more_floors === 1 }
        : {}),
      ...(result.link?.user !== undefined ? { author: result.link.user } : {}),
      ...(result.link?.topics !== undefined ? { topics: result.link.topics } : {}),
      ...(result.link?.hashtags !== undefined ? { hashtags: result.link.hashtags } : {}),
    };
  }

  /** 子评论游标翻页。 */
  async getSubComments(params: SubCommentsParams): Promise<SubCommentsResult> {
    const { rootCommentId, lastval } = params;
    const body = await this.transport.request<XiaoheiheResponse<SubCommentsResult>>({
      path: "/bbs/app/comment/sub/comments",
      params: {
        root_comment_id: rootCommentId,
        ...(lastval !== undefined ? { lastval } : {}),
      },
    });
    return body.result ?? { has_more: false, comments: [] };
  }
}
