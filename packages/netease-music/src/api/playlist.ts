/**
 * 歌单/专辑展开与歌词 API。
 */
import type { LyricInfo, MediaItem, SongInfo } from "../types.js";
import { WeapiSession } from "./session.js";
import { SongApi } from "./song.js";

const PLAYLIST_DETAIL_PATH = "/weapi/v6/playlist/detail";
const ALBUM_DETAIL_PATH = "/weapi/v1/album";
const LYRIC_PATH = "/weapi/song/lyric";

/** 从歌曲原始字段构造 MediaItem。 */
function songToMediaItem(song: Record<string, unknown>, idPrefix: string): MediaItem {
  const id = String(song.id ?? "");
  const title = String(song.name ?? "");
  const artists = Array.isArray(song.ar)
    ? (song.ar as Array<Record<string, unknown>>).map((artist) => String(artist.name ?? ""))
    : [];
  const album = ((song.al ?? {}) as Record<string, unknown>).name;
  const picUrl = ((song.al ?? {}) as Record<string, unknown>).picUrl;
  const durationMs = Number(song.dt ?? 0);
  return {
    type: "song",
    id,
    title,
    artists: artists.filter((name) => name !== ""),
    ...(typeof album === "string" && album !== "" ? { album } : {}),
    ...(typeof picUrl === "string" && picUrl !== "" ? { coverUrl: picUrl } : {}),
    ...(durationMs > 0 ? { durationMs } : {}),
  };
}

/** 歌单/专辑 API。 */
export class PlaylistApi {
  readonly #session: WeapiSession;
  readonly #songs: SongApi;

  constructor(session: WeapiSession) {
    this.#session = session;
    this.#songs = new SongApi(session);
  }

  /** 展开歌单,返回歌单信息 + 歌曲清单。 */
  async getPlaylist(id: string): Promise<MediaItem[]> {
    const body = await this.#session.post(PLAYLIST_DETAIL_PATH, {
      id: Number(id),
      n: 100000,
      s: 8,
    });
    const playlist = (body.playlist ?? {}) as Record<string, unknown>;
    const name = String(playlist.name ?? "");
    const coverUrl = String(playlist.coverImgUrl ?? "");
    const rawTracks = Array.isArray(playlist.tracks)
      ? (playlist.tracks as Array<Record<string, unknown>>)
      : [];
    const tracks = rawTracks.map((song) => songToMediaItem(song, id));
    return [
      {
        type: "playlist",
        id,
        title: name,
        ...(coverUrl !== "" ? { coverUrl } : {}),
        tracks,
      },
    ];
  }

  /** 展开专辑,返回专辑信息 + 歌曲清单。 */
  async getAlbum(id: string): Promise<MediaItem[]> {
    const body = await this.#session.post(`${ALBUM_DETAIL_PATH}/${Number(id)}`, {});
    const album = (body.album ?? {}) as Record<string, unknown>;
    const name = String(album.name ?? "");
    const coverUrl = String(album.picUrl ?? "");
    const rawSongs = Array.isArray(body.songs)
      ? (body.songs as Array<Record<string, unknown>>)
      : [];
    const tracks = rawSongs.map((song) => songToMediaItem(song, id));
    return [
      {
        type: "album",
        id,
        title: name,
        ...(coverUrl !== "" ? { coverUrl } : {}),
        tracks,
      },
    ];
  }

  /** 获取歌曲信息(单个)。 */
  async getSongInfo(id: string): Promise<SongInfo> {
    const [info] = await this.#songs.getDetail([id]);
    if (info === undefined) {
      throw new Error("song not found");
    }
    return info;
  }
}

/** 歌词 API。 */
export class LyricApi {
  readonly #session: WeapiSession;

  constructor(session: WeapiSession) {
    this.#session = session;
  }

  /** 获取歌词(LRC 原文 + 翻译)。 */
  async getLyric(id: string): Promise<LyricInfo> {
    const body = await this.#session.post(LYRIC_PATH, {
      id: Number(id),
      tv: -1,
      lv: -1,
      rv: -1,
      kv: -1,
      _nmclfl: 1,
    });
    const lrc = (body.lrc ?? {}) as Record<string, unknown>;
    const tlyric = (body.tlyric ?? {}) as Record<string, unknown>;
    const original = typeof lrc.lyric === "string" ? lrc.lyric : "";
    const translated = typeof tlyric.lyric === "string" ? tlyric.lyric : "";
    return {
      ...(original !== "" ? { original } : {}),
      ...(translated !== "" && translated !== original ? { translated } : {}),
    };
  }
}
