import { BilibiliError } from "./errors.js";
import type { ApiSession } from "./network.js";
import type {
  MediaItem,
  MediaStream,
  PlayStream,
  StreamOptions,
  StreamResolver,
} from "./types.js";
import { VideoCodec } from "./types.js";

/** 编码优先级(从优到次)。 */
const CODEC_PRIORITY = [VideoCodec.AV1, VideoCodec.HEVC, VideoCodec.AVC];

interface DashEntry {
  id: number;
  codecid?: number;
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
  bandwidth?: number;
  frameRate?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  codecs?: string;
}

interface DashData {
  video: DashEntry[];
  audio: DashEntry[];
  duration?: number;
}

interface PlayUrlData {
  quality: number;
  timelength?: number;
  dash?: DashData;
  durl?: Array<{ url?: string; backup_url?: string[]; length?: number }>;
  accept_quality?: number[];
}

/** 从 DASH 条目提取可用 URL 列表。 */
function extractUrls(entry: DashEntry): string[] {
  const urls: string[] = [];
  for (const key of ["baseUrl", "base_url", "backupUrl", "backup_url"] as const) {
    const value = entry[key];
    if (typeof value === "string") {
      urls.push(value);
    } else if (Array.isArray(value)) {
      urls.push(...value);
    }
  }
  return urls;
}

/** 播放流解析器。 */
export class StreamResolverImpl implements StreamResolver {
  readonly #session: ApiSession;

  constructor(session: ApiSession) {
    this.#session = session;
  }

  async getStreams(item: MediaItem, options: StreamOptions = {}): Promise<PlayStream> {
    if (item.type === "audio") {
      return this.#getAudioStream(item);
    }
    if (item.bvid === undefined || item.cid === undefined) {
      throw new BilibiliError("INVALID_URL", "MediaItem lacks bvid/cid for stream resolution");
    }
    const targetQuality = options.quality ?? 80;

    if (item.type === "bangumi" || item.type === "cheese") {
      return this.#getPgcStream(item, targetQuality);
    }

    interface PlayUrlResponse {
      quality: number;
      timelength?: number;
      dash?: DashData;
      durl?: Array<{ url?: string; backup_url?: string[]; length?: number }>;
      accept_quality?: number[];
    }
    const data = await this.#session.get<PlayUrlResponse>(
      `${this.#session.baseUrl}/x/player/wbi/playurl`,
      {
        bvid: item.bvid,
        cid: item.cid,
        qn: targetQuality,
        fnver: 0,
        fnval: 4048,
        fourk: 1,
      },
    );

    // DASH 格式:音视频分离。
    if (data.dash !== undefined) {
      return this.#buildDashStream(data);
    }

    // 非 DASH(MP4/FLV):单视频流。
    const durl = data.durl ?? [];
    const urls = durl.flatMap((entry: { url?: string; backup_url?: string[] }) => {
      const list: string[] = [];
      if (entry.url !== undefined) {
        list.push(entry.url);
      }
      if (Array.isArray(entry.backup_url)) {
        list.push(...entry.backup_url);
      }
      return list;
    });
    return {
      quality: data.quality,
      videoStreams: [{ id: data.quality, urls, raw: data }],
      audioStreams: [],
      ...(data.timelength !== undefined ? { timelength: data.timelength } : {}),
      dash: false,
    };
  }

  /** 番剧/课程取流:pgc/pugv playurl。 */
  async #getPgcStream(item: MediaItem, quality: number): Promise<PlayStream> {
    interface PgcResponse {
      quality: number;
      timelength?: number;
      dash?: DashData;
      durl?: Array<{ url?: string; backup_url?: string[]; length?: number }>;
    }
    const params = {
      cid: item.cid ?? 0,
      qn: quality,
      fnver: 0,
      fnval: 4048,
      fourk: 1,
    };
    const data =
      item.type === "bangumi"
        ? await this.#session.getPlain<PgcResponse>(
            `${this.#session.baseUrl}/pgc/player/web/playurl`,
            { ...params, bvid: item.bvid ?? "", ep_id: item.epId ?? 0 },
          )
        : await this.#session.getPlain<PgcResponse>(
            `${this.#session.baseUrl}/pugv/player/web/playurl`,
            { ...params, avid: item.aid ?? 0, ep_id: item.epId ?? 0 },
          );

    if (data.dash !== undefined) {
      return this.#buildDashStream(data);
    }
    const durl = data.durl ?? [];
    const urls = durl.flatMap((entry) => {
      const list: string[] = [];
      if (entry.url !== undefined) {
        list.push(entry.url);
      }
      if (Array.isArray(entry.backup_url)) {
        list.push(...entry.backup_url);
      }
      return list;
    });
    return {
      quality: data.quality,
      videoStreams: [{ id: data.quality, urls, raw: data }],
      audioStreams: [],
      ...(data.timelength !== undefined ? { timelength: data.timelength } : {}),
      dash: false,
    };
  }

  /** B 站音乐取流。 */
  async #getAudioStream(item: MediaItem): Promise<PlayStream> {
    if (item.sid === undefined) {
      throw new BilibiliError("INVALID_URL", "Audio item lacks sid");
    }
    interface AudioUrlData {
      url?: string;
      timeout?: number;
      cdn_list?: string[];
    }
    const data = await this.#session.getPlain<AudioUrlData>(
      `${this.#session.baseUrl}/audio/music-service-c/web/url`,
      { sid: item.sid, privilege: 2, quality: 2 },
    );
    const urls: string[] = [];
    if (data.url !== undefined) {
      urls.push(data.url);
    }
    if (Array.isArray(data.cdn_list)) {
      urls.push(...data.cdn_list);
    }
    return {
      quality: 2,
      videoStreams: [],
      audioStreams: [{ id: 2, urls, audio: { id: 2 }, raw: data }],
      dash: false,
    };
  }

  #buildDashStream(data: PlayUrlData): PlayStream {
    const dash = data.dash as DashData;
    const videoStreams = dash.video.map((entry) => ({
      id: entry.id,
      ...(entry.codecid !== undefined ? { codecId: entry.codecid } : {}),
      urls: extractUrls(entry),
      ...(entry.bandwidth !== undefined ? { bandwidth: entry.bandwidth } : {}),
      ...(entry.frameRate !== undefined ? { frameRate: entry.frameRate } : {}),
      raw: entry,
    }));
    const audioStreams = dash.audio.map((entry) => ({
      id: entry.id,
      urls: extractUrls(entry),
      ...(entry.bandwidth !== undefined ? { bandwidth: entry.bandwidth } : {}),
      audio: {
        id: entry.id,
        ...(entry.bandwidth !== undefined ? { bandwidth: entry.bandwidth } : {}),
      },
      raw: entry,
    }));

    return {
      quality: data.quality,
      videoStreams,
      audioStreams,
      ...(data.timelength !== undefined ? { timelength: data.timelength } : {}),
      dash: true,
    };
  }
}

/** 按目标清晰度和编码挑选最佳流。 */
export function selectBestStream(
  streams: MediaStream[],
  targetQuality: number,
  codec?: VideoCodec,
): MediaStream | undefined {
  if (streams.length === 0) {
    return undefined;
  }
  // 过滤出 <= 目标清晰度的流,取最高。
  const candidates = streams
    .filter((stream) => stream.id <= targetQuality)
    .sort((a, b) => b.id - a.id);

  if (codec !== undefined) {
    const byCodec = candidates.find((stream) => stream.codecId === codec);
    if (byCodec !== undefined) {
      return byCodec;
    }
  }
  // 按编码优先级选。
  for (const preferredCodec of CODEC_PRIORITY) {
    const match = candidates.find((stream) => stream.codecId === preferredCodec);
    if (match !== undefined) {
      return match;
    }
  }
  return candidates[0];
}

/** 选择最佳音频流:按码率优先(音频 id 不是清晰度,不能用过滤逻辑)。 */
export function selectBestAudioStream(streams: MediaStream[]): MediaStream | undefined {
  if (streams.length === 0) {
    return undefined;
  }
  return [...streams].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
}
