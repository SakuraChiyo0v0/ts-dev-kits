/**
 * 歌曲 API:详情、取流、权限、VIP 信息。
 */
import { NeteaseError } from "../errors.js";
import type { QualityLevel, SongInfo, SongPrivilege, StreamInfo, VipInfo } from "../types.js";
import { WeapiSession } from "./session.js";

const SONG_DETAIL_PATH = "/weapi/v3/song/detail";
const SONG_URL_PATH = "/weapi/song/enhance/player/url/v1";
const VIP_INFO_PATH = "/weapi/music-vip-membership/front/vip/info";

/** 品质 → 服务端 level 参数(一致)。 */
export const QUALITY_LEVELS: readonly QualityLevel[] = [
  "standard",
  "higher",
  "exhigh",
  "lossless",
  "hires",
];

/**
 * 从 song detail 原始字段(st/fee)与账号 VIP 状态提取可下载品质。
 *
 * 规则(严格模式,试听 = 拒绝;基于真实接口行为实测验证):
 *   - st != 0(下架/不可用)→ 空;
 *   - 免费歌曲(fee=0)+ 非 VIP → standard/higher/exhigh(服务端实测:完整 320k,合法);
 *   - 免费歌曲 + VIP → 追加 lossless(服务端实测:hires 请求也会降级为 lossless);
 *   - VIP 歌曲(fee=1/8)+ 非 VIP → 空(服务端实测:只给 standard 128k 试听,SDK 拒绝);
 *   - VIP 歌曲 + VIP → standard..lossless(hires 请求服务端统一降级 lossless)。
 * 最终裁决始终在取流响应:url=null → PRIVILEGE_DENIED;freeTrialInfo → TRIAL_ONLY。
 */
export function extractAvailableLevels(
  raw: Record<string, unknown>,
  isVip: boolean,
): QualityLevel[] {
  const st = Number(raw.st ?? -1);
  const fee = Number(raw.fee ?? -1);

  // 歌曲下架/不可用。
  if (st !== 0) {
    return [];
  }

  const isVipSong = fee === 1 || fee === 8;
  if (isVipSong && !isVip) {
    // VIP 歌曲 + 非 VIP 账号:服务端只会给试听片段 → 拒绝。
    return [];
  }
  if (isVip) {
    return ["standard", "higher", "exhigh", "lossless"];
  }
  return ["standard", "higher", "exhigh"];
}

/** 把服务端歌曲对象解析为 SongInfo（兼容 detail 与 recommend 两种字段命名）。 */
function parseSong(raw: Record<string, unknown>): SongInfo | null {
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
    ...(Number(raw.st ?? -1) !== -1 ? { st: Number(raw.st) } : {}),
    ...(Number(raw.fee ?? -1) !== -1 ? { fee: Number(raw.fee) } : {}),
  };
}

/** 歌曲 API。 */
export class SongApi {
  readonly #session: WeapiSession;

  constructor(session: WeapiSession) {
    this.#session = session;
  }

  /** 获取歌曲详情。 */
  async getDetail(ids: string[]): Promise<SongInfo[]> {
    const c = JSON.stringify(ids.map((id) => ({ id: Number(id) })));
    const body = await this.#session.post(SONG_DETAIL_PATH, { c });
    const songs = Array.isArray(body.songs) ? (body.songs as Array<Record<string, unknown>>) : [];
    const result: SongInfo[] = [];
    for (const song of songs) {
      const info = parseSong(song);
      if (info !== null) result.push(info);
    }
    return result;
  }

  /** 获取每日推荐歌曲（需登录，约 30 首）。 */
  async getRecommendSongs(): Promise<SongInfo[]> {
    const body = await this.#session.post("/weapi/v1/discovery/recommend/songs", {});
    const list = Array.isArray(body.recommend)
      ? (body.recommend as Array<Record<string, unknown>>)
      : [];
    const result: SongInfo[] = [];
    for (const song of list) {
      const info = parseSong(song);
      if (info !== null) result.push(info);
    }
    return result;
  }

  /** 获取歌曲权限(单个 id);基于 song detail 的 fee/st + 账号 VIP 状态,不依赖已废弃的 privilege 接口。 */
  async getPrivilege(id: string): Promise<SongPrivilege> {
    const [vipInfo, details] = await Promise.all([
      this.getVipInfo(),
      this.getDetail([id]),
    ]);
    const song = details[0];
    if (song === undefined) {
      throw new NeteaseError("NOT_FOUND", `song ${id} not found`);
    }
    const raw: Record<string, unknown> = {
      id,
      st: song.st ?? 0,
      fee: song.fee ?? 0,
    };
    const availableLevels = extractAvailableLevels(raw, vipInfo.isVip);
    const fee = Number(raw.fee ?? -1);
    const isVipSong = fee === 1 || fee === 8;
    return {
      id,
      availableLevels,
      canPlay: availableLevels.length > 0,
      isVipSong,
      raw,
    };
  }

  /** 获取账号 VIP 信息。未登录视为非 VIP(匿名用户本来就无会员权益)。 */
  async getVipInfo(): Promise<VipInfo> {
    let body: Record<string, unknown>;
    try {
      body = await this.#session.post(VIP_INFO_PATH, { userId: "" });
    } catch (error) {
      if (error instanceof NeteaseError && error.code === "AUTH_EXPIRED") {
        // 未登录/登录态失效:视为非 VIP,让取流接口按匿名身份裁决。
        return { isVip: false, level: 0, vipType: 0 };
      }
      throw error;
    }
    const data = (body.data ?? {}) as Record<string, unknown>;
    const isVip = Boolean(data.redVipLevel) || Boolean(data.musicPackDescription);
    const level = Number(data.redVipLevel ?? 0);
    const vipType = Number(data.vipType ?? 0);
    return { isVip, level, vipType };
  }

  /**
   * 取流:请求指定品质的播放 URL。
   * @param ids 歌曲 ID 数组(取流接口支持批量)
   * @param level 目标品质
   * @returns 每首歌的 StreamInfo(失败项抛错;试听特征标记 isTrial)
   */
  async getStreams(ids: string[], level: QualityLevel): Promise<StreamInfo[]> {
    const body = await this.#session.post(SONG_URL_PATH, {
      ids: JSON.stringify(ids.map((id) => Number(id))),
      level,
      encodeType: "flac",
    });
    const data = Array.isArray(body.data) ? (body.data as Array<Record<string, unknown>>) : [];
    const result: StreamInfo[] = [];
    for (const item of data) {
      const id = String(item.id ?? "");
      const url = typeof item.url === "string" ? item.url : "";
      const freeTrialInfo = item.freeTrialInfo;
      // 服务端对无权限歌曲返回 url=null 或带 freeTrialInfo 的试听片段。
      const isTrial = freeTrialInfo !== null && freeTrialInfo !== undefined;
      const time = Number(item.time ?? 0);
      const size = Number(item.size ?? 0);
      const actualLevel = typeof item.level === "string" ? (item.level as QualityLevel) : level;
      if (url === "") {
        throw new NeteaseError("PRIVILEGE_DENIED", `song ${id}: no playable URL for level "${level}"`, {
          apiCode: Number(body.code),
        });
      }
      result.push({
        url,
        level: actualLevel,
        ...(size > 0 ? { size } : {}),
        // time 单位与 song detail 的 dt 一致(毫秒)。
        ...(time > 0 ? { durationMs: time } : {}),
        isTrial,
      });
    }
    return result;
  }
}
