/**
 * 用户与收藏夹 API:账号信息、用户歌单、红心歌曲、歌单增删歌曲、歌单订阅。
 *
 * 路径对照 Binaryify/NeteaseCloudMusicApi 与 Music163Api-Go 已验证的实现:
 *   - 用户歌单列表:   /weapi/user/playlist { uid, limit, offset, includeVideo }
 *   - 红心歌曲列表:   /weapi/song/like/get { uid }
 *   - 检查是否红心:   /weapi/song/like/check { trackIds }
 *   - 红心/取消红心:  /weapi/song/like { trackId, like }
 *   - 歌单增删歌曲:   /weapi/playlist/manipulate/tracks { op, pid, trackIds, imme }
 *   - 收藏/取消收藏:  /weapi/playlist/subscribe|unsubscribe { id }(老 eapi 路径已 404,用 weapi)
 *   - 创建歌单:       /weapi/playlist/create { name, privacy, type }
 *   - 删除歌单:       /weapi/playlist/remove { ids }
 *
 * 合规说明:以上均为"操作登录者自己的收藏/歌单",不涉及"非 VIP 下载 VIP 歌曲";
 * 下载链路的权限预检与试听拦截不受影响。
 */
import { NeteaseError } from "../errors.js";
import { WeapiSession } from "./session.js";

const ACCOUNT_GET_PATH = "/weapi/w/nuser/account/get";
const USER_PLAYLIST_PATH = "/weapi/user/playlist";
const LIKE_GET_PATH = "/weapi/song/like/get";
const LIKE_CHECK_PATH = "/weapi/song/like/check";
const LIKE_PATH = "/weapi/song/like";
const PLAYLIST_TRACKS_PATH = "/weapi/playlist/manipulate/tracks";
const PLAYLIST_CREATE_PATH = "/weapi/playlist/create";
const PLAYLIST_REMOVE_PATH = "/weapi/playlist/remove";
/** 收藏/取消收藏歌单。注:老版 eapi 路径(/eapi/playlist/subscribe)实测 404,改用 weapi。 */
const PLAYLIST_SUBSCRIBE_PATH = "/weapi/playlist/subscribe";
const PLAYLIST_UNSUBSCRIBE_PATH = "/weapi/playlist/unsubscribe";

/** 当前登录账号信息。 */
export interface AccountInfo {
  userId: string;
  nickname: string;
  avatarUrl?: string;
  signature?: string;
}

/** 歌单摘要(用户歌单列表中的一项)。 */
export interface UserPlaylistSummary {
  id: string;
  name: string;
  /** 歌曲数量。 */
  trackCount: number;
  /** 5 = "我喜欢的音乐"(红心歌单)。 */
  specialType: number;
  /** 是否订阅(收藏)了该歌单。 */
  subscribed: boolean;
  coverUrl?: string;
  /** 歌单创建者昵称。 */
  creatorName?: string;
}

/** 用户/收藏夹 API。 */
export class UserApi {
  readonly #session: WeapiSession;

  constructor(session: WeapiSession) {
    this.#session = session;
  }

  /** 获取当前登录账号信息。 */
  async getAccountInfo(): Promise<AccountInfo> {
    const body = await this.#session.post(ACCOUNT_GET_PATH, {});
    const profile = (body.profile ?? {}) as Record<string, unknown>;
    const account = (body.account ?? {}) as Record<string, unknown>;
    const userId = String(profile.userId ?? account.id ?? "");
    if (userId === "") {
      throw new NeteaseError("API_ERROR", "account/get response missing userId", { cause: body });
    }
    return {
      userId,
      nickname: String(profile.nickname ?? ""),
      ...(typeof profile.avatarUrl === "string" && profile.avatarUrl !== ""
        ? { avatarUrl: profile.avatarUrl }
        : {}),
      ...(typeof profile.signature === "string" && profile.signature !== ""
        ? { signature: profile.signature }
        : {}),
    };
  }

  /**
   * 获取用户歌单列表(uid 缺省用当前登录账号)。
   * 结果含"我喜欢的音乐"(specialType=5)与订阅的他人歌单(subscribed=true)。
   */
  async getUserPlaylists(options: {
    uid?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<UserPlaylistSummary[]> {
    const uid = options.uid ?? (await this.#resolveUid());
    const body = await this.#session.post(USER_PLAYLIST_PATH, {
      uid: Number(uid),
      limit: options.limit ?? 30,
      offset: options.offset ?? 0,
      includeVideo: true,
    });
    const list = Array.isArray(body.playlist) ? (body.playlist as Array<Record<string, unknown>>) : [];
    return list.map((item) => this.#toPlaylistSummary(item));
  }

  /** 获取红心(喜欢)歌曲 id 列表。 */
  async getLikeList(options: { uid?: string } = {}): Promise<string[]> {
    const uid = options.uid ?? (await this.#resolveUid());
    const body = await this.#session.post(LIKE_GET_PATH, { uid: Number(uid) });
    const ids = Array.isArray(body.ids) ? (body.ids as unknown[]) : [];
    return ids.map((id) => String(id));
  }

  /**
   * 批量检查歌曲是否已红心。返回 Map<songId, liked>。
   * 注:该接口有缓存延迟(分钟级),刚 like/unlike 后立即调用可能返回旧值;
   * 需要即时结果时请用歌单 trackCount 或重试。
   */
  async checkLiked(trackIds: Array<string | number>): Promise<Map<string, boolean>> {
    const ids = trackIds.map((id) => Number(id));
    if (ids.length === 0) {
      return new Map();
    }
    // 实测:trackIds 需为 JSON 数组字符串(如 "[32701996]"),逗号串会 400。
    const body = await this.#session.post(LIKE_CHECK_PATH, {
      trackIds: JSON.stringify(ids),
    });
    const list = Array.isArray(body.ids) ? (body.ids as unknown[]) : [];
    const result = new Map<string, boolean>();
    // 响应 ids 为 0/1 数组,顺序与请求一致;也有 booleans 形式,尽量兼容。
    list.forEach((value, index) => {
      const id = ids[index];
      if (id !== undefined) {
        result.set(String(id), Number(value) === 1 || value === true);
      }
    });
    return result;
  }

  /** 红心收藏一首歌。 */
  async likeSong(trackId: string | number): Promise<void> {
    const body = await this.#session.post(LIKE_PATH, {
      trackId: Number(trackId),
      like: true,
    });
    if (Number(body.code ?? 0) !== 200) {
      throw new NeteaseError("API_ERROR", `song/like failed (code ${String(body.code)})`, {
        cause: body,
      });
    }
  }

  /** 取消红心收藏一首歌。 */
  async unlikeSong(trackId: string | number): Promise<void> {
    const body = await this.#session.post(LIKE_PATH, {
      trackId: Number(trackId),
      like: false,
    });
    if (Number(body.code ?? 0) !== 200) {
      throw new NeteaseError("API_ERROR", `song/like failed (code ${String(body.code)})`, {
        cause: body,
      });
    }
  }

  /** 向歌单添加歌曲。 */
  async addTracksToPlaylist(playlistId: string | number, trackIds: Array<string | number>): Promise<void> {
    await this.#manipulateTracks(playlistId, trackIds, "add");
  }

  /** 从歌单移除歌曲。 */
  async removeTracksFromPlaylist(
    playlistId: string | number,
    trackIds: Array<string | number>,
  ): Promise<void> {
    await this.#manipulateTracks(playlistId, trackIds, "del");
  }

  /** 收藏(订阅)歌单。 */
  async subscribePlaylist(playlistId: string | number): Promise<void> {
    const body = await this.#session.post(PLAYLIST_SUBSCRIBE_PATH, {
      id: Number(playlistId),
    });
    if (Number(body.code ?? 0) !== 200) {
      throw new NeteaseError("API_ERROR", `playlist/subscribe failed (code ${String(body.code)})`, {
        cause: body,
      });
    }
  }

  /** 取消收藏(退订)歌单。 */
  async unsubscribePlaylist(playlistId: string | number): Promise<void> {
    const body = await this.#session.post(PLAYLIST_UNSUBSCRIBE_PATH, {
      id: Number(playlistId),
    });
    if (Number(body.code ?? 0) !== 200) {
      throw new NeteaseError("API_ERROR", `playlist/unsubscribe failed (code ${String(body.code)})`, {
        cause: body,
      });
    }
  }

  /** 创建歌单,返回新歌单 id。privacy: 0 普通,10 隐私。type: NORMAL|VIDEO|SHARED。 */
  async createPlaylist(options: {
    name: string;
    privacy?: number;
    type?: string;
  }): Promise<string> {
    if (options.name.trim() === "") {
      throw new NeteaseError("INVALID_URL", "playlist name must not be empty");
    }
    const body = await this.#session.post(PLAYLIST_CREATE_PATH, {
      name: options.name,
      privacy: String(options.privacy ?? 0),
      type: options.type ?? "NORMAL",
    });
    const playlist = (body.playlist ?? {}) as Record<string, unknown>;
    const id = String(playlist.id ?? "");
    if (id === "") {
      throw new NeteaseError("API_ERROR", "playlist/create response missing id", { cause: body });
    }
    return id;
  }

  /** 删除歌单。 */
  async deletePlaylist(playlistId: string | number): Promise<void> {
    const body = await this.#session.post(PLAYLIST_REMOVE_PATH, {
      ids: `[${Number(playlistId)}]`,
    });
    if (Number(body.code ?? 0) !== 200) {
      throw new NeteaseError("API_ERROR", `playlist/remove failed (code ${String(body.code)})`, {
        cause: body,
      });
    }
  }

  async #manipulateTracks(
    playlistId: string | number,
    trackIds: Array<string | number>,
    op: "add" | "del",
  ): Promise<void> {
    if (trackIds.length === 0) {
      throw new NeteaseError("INVALID_URL", "trackIds must not be empty");
    }
    const body = await this.#session.post(PLAYLIST_TRACKS_PATH, {
      op,
      pid: Number(playlistId),
      trackIds: JSON.stringify(trackIds.map((id) => Number(id))),
      imme: "true",
    });
    if (Number(body.code ?? 0) !== 200) {
      throw new NeteaseError("API_ERROR", `playlist/manipulate/tracks failed (code ${String(body.code)})`, {
        cause: body,
      });
    }
  }

  async #resolveUid(): Promise<string> {
    return (await this.getAccountInfo()).userId;
  }

  #toPlaylistSummary(item: Record<string, unknown>): UserPlaylistSummary {
    const id = String(item.id ?? "");
    const creator = (item.creator ?? {}) as Record<string, unknown>;
    const coverUrl = String(item.coverImgUrl ?? "");
    return {
      id,
      name: String(item.name ?? ""),
      trackCount: Number(item.trackCount ?? 0),
      specialType: Number(item.specialType ?? 0),
      subscribed: item.subscribed === true || item.subscribed === "true",
      ...(coverUrl !== "" ? { coverUrl } : {}),
      ...(typeof creator.nickname === "string" && creator.nickname !== ""
        ? { creatorName: creator.nickname }
        : {}),
    };
  }
}
