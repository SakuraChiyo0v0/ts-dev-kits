/** 推荐/发现 API：每日推荐歌单、私人 FM（每日电台）。 */
import type { RecommendPlaylist, SongInfo } from "../types.js";
import { WeapiSession } from "./session.js";

const RECOMMEND_PLAYLIST_PATH = "/weapi/v1/discovery/recommend/resource";
const PERSONAL_FM_PATH = "/weapi/v1/radio/get";

/** 把私人 FM 的歌曲对象解析为 SongInfo（兼容 detail 的 ar/al/dt 与 fm 的 artists/album/duration 命名）。 */
function parseFmSong(raw: Record<string, unknown>): SongInfo | null {
  const id = String(raw.id ?? "");
  const title = String(raw.name ?? "");
  if (id === "" || title === "") return null;
  const artistsArr = Array.isArray(raw.ar)
    ? raw.ar
    : Array.isArray(raw.artists)
      ? raw.artists
      : [];
  const artists = (artistsArr as Array<Record<string, unknown>>).map((a) => String(a.name ?? ""));
  const albumObj = (raw.al ?? raw.album ?? {}) as Record<string, unknown>;
  const album = albumObj.name;
  const durationMs = Number(raw.dt ?? raw.duration ?? 0);
  const picUrl = albumObj.picUrl ?? raw.picUrl;
  return {
    id,
    title,
    artists: artists.filter((name) => name !== ""),
    album: typeof album === "string" ? album : "",
    durationMs,
    ...(typeof picUrl === "string" && picUrl !== "" ? { coverUrl: picUrl } : {}),
  };
}

/** 推荐/发现 API。 */
export class RecommendApi {
  readonly #session: WeapiSession;

  constructor(session: WeapiSession) {
    this.#session = session;
  }

  /** 每日推荐歌单（约 30 个）。 */
  async getRecommendPlaylists(): Promise<RecommendPlaylist[]> {
    const body = await this.#session.post(RECOMMEND_PLAYLIST_PATH, {});
    const list = Array.isArray(body.recommend) ? (body.recommend as Array<Record<string, unknown>>) : [];
    const result: RecommendPlaylist[] = [];
    for (const item of list) {
      const id = String(item.id ?? "");
      const name = String(item.name ?? "");
      if (id === "" || name === "") continue;
      const picUrl = item.picUrl;
      result.push({
        id,
        name,
        ...(typeof picUrl === "string" && picUrl !== "" ? { coverUrl: picUrl } : {}),
        playCount: Number(item.playCount ?? 0),
      });
    }
    return result;
  }

  /** 私人 FM（每日电台）歌曲列表。 */
  async getPersonalFm(): Promise<SongInfo[]> {
    const body = await this.#session.post(PERSONAL_FM_PATH, {});
    const list = Array.isArray(body.data) ? (body.data as Array<Record<string, unknown>>) : [];
    const result: SongInfo[] = [];
    for (const song of list) {
      const info = parseFmSong(song);
      if (info !== null) result.push(info);
    }
    return result;
  }
}
