import { BilibiliError } from "../errors.js";
import type { ApiSession } from "../network.js";
import { parseUrl } from "../url.js";
import type { MediaItem, Parser } from "../types.js";

/** B 站音乐解析器(au/am 链接)。 */
export class AudioParser implements Parser {
  readonly type = "audio" as const;
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  async parse(url: string): Promise<MediaItem[]> {
    const parsed = parseUrl(url);
    if (parsed.type !== "audio" || parsed.id === undefined) {
      throw new BilibiliError("INVALID_URL", "Invalid audio URL");
    }
    const sid = Number(parsed.id);
    const isMenu = url.includes("/am");

    if (isMenu) {
      // 歌单 → 列表。
      interface MenuData {
        data?: Array<{
          id: number;
          title?: string;
          cover?: string;
          duration?: number;
          author?: string;
        }>;
        title?: string;
      }
      const data = await this.#session.getPlain<MenuData>(
        `${this.#session.baseUrl}/audio/music-service-c/web/song/of-menu`,
        { sid, pn: 1, ps: 100 },
      );
      return (data.data ?? []).map((song) => {
        const item: MediaItem = {
          type: "audio",
          id: `au${song.id}`,
          sid: song.id,
          title: song.title ?? `au${song.id}`,
          raw: song,
        };
        if (song.cover !== undefined) {
          item.cover = song.cover;
        }
        if (song.duration !== undefined) {
          item.duration = song.duration;
        }
        return item;
      });
    }

    // 单曲。
    interface SongData {
      id: number;
      title?: string;
      cover?: string;
      duration?: number;
      author?: string;
    }
    const data = await this.#session.getPlain<SongData>(
      `${this.#session.baseUrl}/audio/music-service-c/web/song/info`,
      { sid },
    );
    const item: MediaItem = {
      type: "audio",
      id: `au${data.id}`,
      sid: data.id,
      title: data.title ?? `au${data.id}`,
      raw: data,
    };
    if (data.cover !== undefined) {
      item.cover = data.cover;
    }
    if (data.duration !== undefined) {
      item.duration = data.duration;
    }
    return [item];
  }
}
