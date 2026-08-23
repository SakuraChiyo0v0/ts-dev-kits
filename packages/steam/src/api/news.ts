/**
 * news 域 —— 游戏新闻(ISteamNews,无需 key)。
 */
import type { SteamHttpTransport } from "../http.js";
import { SteamEndpoints } from "../endpoints.js";
import type { NewsItem } from "../types.js";

export interface GetNewsOptions {
  /** 返回条数,默认 3。 */
  count?: number;
  /** 内容最大长度。 */
  maxLength?: number;
  /** 新闻源过滤(如 steam_community_announcements)。 */
  feeds?: string[];
}

export class NewsApi {
  constructor(private readonly transport: SteamHttpTransport) {}

  /** 游戏新闻(GetNewsForApp/v2,无需 key)。 */
  async getNewsForApp(appid: number, options: GetNewsOptions = {}): Promise<NewsItem[]> {
    const params: Record<string, string | number | undefined> = { appid };
    if (options.count !== undefined) {
      params.count = options.count;
    }
    if (options.maxLength !== undefined) {
      params.maxlength = options.maxLength;
    }
    if (options.feeds !== undefined && options.feeds.length > 0) {
      params.feeds = options.feeds.join(",");
    }
    const body = await this.transport.request<{ appnews: { newsitems?: NewsItem[] } }>({
      host: "api",
      path: SteamEndpoints.api.newsForApp,
      params,
    });
    return body.appnews.newsitems ?? [];
  }
}
