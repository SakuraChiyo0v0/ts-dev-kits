import { BilibiliError } from "../errors.js";
import type { ApiSession } from "../network.js";
import { parseUrl } from "../url.js";
import type { MediaItem, Parser } from "../types.js";

interface CheeseResult {
  ep_id: number;
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  cover?: string;
  duration?: number;
  season?: { season_id: number; title: string };
  episodes?: Array<{
    ep_id: number;
    aid: number;
    bvid: string;
    cid: number;
    title: string;
    cover?: string;
    duration?: number;
  }>;
}

/** 课程(芝士)解析器(cheese 链接)。 */
export class CheeseParser implements Parser {
  readonly type = "cheese" as const;
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  async parse(url: string): Promise<MediaItem[]> {
    if (!url.includes("/cheese")) {
      throw new BilibiliError("INVALID_URL", "Invalid cheese URL");
    }
    const epMatch = url.match(/ep(\d+)/u);
    if (!epMatch) {
      throw new BilibiliError("INVALID_URL", "Cheese URL must contain ep id");
    }
    const epId = Number(epMatch[1]);
    const data = await this.#session.getPlain<{ result: CheeseResult }>(
      `${this.#session.baseUrl}/pugv/view/web/season`,
      { ep_id: epId },
    );
    const result = data.result;
    const seasonId = result.season?.season_id;
    const episodes = result.episodes ?? [];

    const buildItem = (episode: CheeseResult["episodes"] extends undefined ? never : NonNullable<CheeseResult["episodes"]>[number] | CheeseResult): MediaItem => {
      const item: MediaItem = {
        type: "cheese",
        id: `cheese-ep${episode.ep_id}`,
        aid: episode.aid,
        bvid: episode.bvid,
        cid: episode.cid,
        epId: episode.ep_id,
        title: episode.title,
        raw: result,
      };
      if (seasonId !== undefined) {
        item.seasonId = seasonId;
      }
      if (episode.cover !== undefined) {
        item.cover = episode.cover;
      }
      if (episode.duration !== undefined) {
        item.duration = episode.duration;
      }
      return item;
    };

    if (episodes.length > 0) {
      return episodes.map((episode) => buildItem(episode));
    }

    // 单集课程。
    return [buildItem(result)];
  }
}
