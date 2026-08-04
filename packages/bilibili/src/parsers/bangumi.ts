import { BilibiliError } from "../errors.js";
import type { ApiSession } from "../network.js";
import { parseUrl } from "../url.js";
import type { MediaItem, Parser } from "../types.js";

interface SeasonResult {
  season_id: number;
  title: string;
  cover?: string;
  episodes?: Array<{
    id: number;
    aid: number;
    bvid: string;
    cid: number;
    title: string;
    cover?: string;
    long_title?: string;
    duration?: number;
  }>;
}

/** 番剧解析器(ep/ss/md 链接)。 */
export class BangumiParser implements Parser {
  readonly type = "bangumi" as const;
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  async parse(url: string): Promise<MediaItem[]> {
    const parsed = parseUrl(url);
    if (parsed.type !== "bangumi" || parsed.id === undefined) {
      throw new BilibiliError("INVALID_URL", "Invalid bangumi URL");
    }
    const param = this.#paramFor(parsed.id, url);
    const data = await this.#session.getPlain<{ result: SeasonResult }>(
      `${this.#session.baseUrl}/pgc/view/web/season`,
      param,
    );
    const result = data.result;
    const seasonId = result.season_id;
    const episodes = result.episodes ?? [];

    return episodes.map((episode) => {
      const item: MediaItem = {
        type: "bangumi",
        id: `ep${episode.id}`,
        aid: episode.aid,
        bvid: episode.bvid,
        cid: episode.cid,
        epId: episode.id,
        seasonId,
        title: episode.long_title ?? episode.title,
        raw: result,
      };
      if (episode.cover !== undefined) {
        item.cover = episode.cover;
      }
      if (episode.duration !== undefined) {
        item.duration = episode.duration;
      }
      return item;
    });
  }

  /** 根据 id 形态决定请求参数:ep_id / season_id / media_id。 */
  #paramFor(id: string, url: string): Record<string, string | number> {
    if (/^\d+$/u.test(id) && url.includes("/ep")) {
      return { ep_id: id };
    }
    if (/^\d+$/u.test(id) && url.includes("/ss")) {
      return { season_id: id };
    }
    // md 开头:先查 media → season_id。
    const mdMatch = url.match(/md(\d+)/u);
    if (mdMatch) {
      const mediaId = mdMatch[1] ?? "";
      // 同步查询无法 await,这里抛错提示。真实 md 场景第二版完善。
      throw new BilibiliError("INVALID_URL", "md links not supported yet, use ep/ss links");
    }
    return { season_id: id };
  }
}
