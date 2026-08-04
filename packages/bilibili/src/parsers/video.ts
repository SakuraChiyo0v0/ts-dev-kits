import { BilibiliError } from "../errors.js";
import type { ApiSession } from "../network.js";
import { parseUrl } from "../url.js";
import type { MediaItem, Parser, VideoPage } from "../types.js";

/** 投稿视频解析器:BV 号 → 视频信息(含分P)。 */
export class VideoParser implements Parser {
  readonly type = "video" as const;
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  async parse(url: string): Promise<MediaItem[]> {
    const parsed = parseUrl(url);
    if (parsed.type !== "video" || parsed.id === undefined) {
      throw new BilibiliError("INVALID_URL", "Invalid video URL");
    }
    const bvid = parsed.id.startsWith("BV") ? parsed.id : await this.aidToBvid(Number(parsed.id));

    interface ViewData {
      bvid: string;
      aid: number;
      cid: number;
      title: string;
      pic: string;
      duration: number;
      desc: string;
      owner: { mid: number; name: string };
      pages?: Array<{ cid: number; page: number; part: string; duration: number }>;
      ugc_season?: { title: string; sections: Array<{ title: string; episodes: Array<Record<string, unknown>> }> } | null;
    }
    const data = await this.#session.get<ViewData>(
      `${this.#session.baseUrl}/x/web-interface/wbi/view`,
      { bvid },
    );

    const pages: VideoPage[] = Array.isArray(data.pages) && data.pages.length > 0
      ? data.pages.map((page) => ({
          cid: page.cid,
          page: page.page,
          part: page.part,
          duration: page.duration,
        }))
      : [];

    // 单P:直接用 cid。多P:返回分P列表,每P一个 MediaItem。
    if (pages.length <= 1) {
      return [
        {
          type: "video",
          id: bvid,
          aid: data.aid,
          bvid,
          cid: data.cid,
          title: data.title,
          cover: data.pic,
          duration: data.duration,
          owner: { mid: data.owner.mid, name: data.owner.name },
          raw: data,
        },
      ];
    }

    return pages.map((page) => ({
      type: "video" as const,
      id: `${bvid}:p${page.page}`,
      aid: data.aid,
      bvid,
      cid: page.cid,
      title: data.title,
      cover: data.pic,
      duration: page.duration,
      owner: { mid: data.owner.mid, name: data.owner.name },
      raw: data,
    }));
  }

  /** av 号转 BV 号。 */
  async aidToBvid(aid: number): Promise<string> {
    const XOR_CODE = 23442827791579n;
    const MAX_AID = 1n << 51n;
    const ALPHABET = "FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf";
    const ENCODE_MAP = [8, 7, 0, 5, 1, 3, 2, 4, 6];

    const bvid: string[] = ["", "", "", "", "", "", "", "", ""];
    let tmp = (MAX_AID | BigInt(aid)) ^ XOR_CODE;
    for (const index of ENCODE_MAP) {
      const char = ALPHABET[Number(tmp % BigInt(ALPHABET.length))];
      bvid[index] = char ?? "";
      tmp /= BigInt(ALPHABET.length);
    }
    return `BV1${bvid.join("")}`;
  }
}
