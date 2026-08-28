/** m3u8 播放列表解析与本地化构建。 */

export interface M3u8Key {
  method: string;
  uri: string;
  iv?: string;
}

export interface M3u8Segment {
  duration: number;
  uri: string;
  /** discontinuity 分组号(广告过滤依据)。 */
  discontinuityGroup: number;
  key?: M3u8Key;
}

export interface M3u8Variant {
  bandwidth: number;
  resolution?: string;
  uri: string;
}

export interface M3u8MediaPlaylist {
  segments: M3u8Segment[];
  targetDuration: number;
  isVod: boolean;
}

export type M3u8Type = "master" | "media";

/** 解析 m3u8 文本,返回类型与内容。 */
export function parseM3u8(content: string): {
  type: M3u8Type;
  media?: M3u8MediaPlaylist;
  variants?: M3u8Variant[];
} {
  const lines = content.split(/\r?\n/);
  if (lines.some((line) => line.startsWith("#EXT-X-STREAM-INF"))) {
    return { type: "master", variants: parseMaster(lines) };
  }
  return { type: "media", media: parseMedia(lines) };
}

function parseMaster(lines: string[]): M3u8Variant[] {
  const variants: M3u8Variant[] = [];
  let pending: M3u8Variant | null = null;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const attrs = parseAttributes(line.slice("#EXT-X-STREAM-INF:".length));
      pending = {
        bandwidth: Number(attrs["BANDWIDTH"] ?? "0") || 0,
        ...(attrs["RESOLUTION"] !== undefined
          ? { resolution: attrs["RESOLUTION"] }
          : {}),
        uri: "",
      };
    } else if (pending !== null && line !== "" && !line.startsWith("#")) {
      pending.uri = line.trim();
      variants.push(pending);
      pending = null;
    }
  }
  return variants;
}

function parseMedia(lines: string[]): M3u8MediaPlaylist {
  const segments: M3u8Segment[] = [];
  let targetDuration = 0;
  let isVod = false;
  let pendingDuration = 0;
  let pendingKey: M3u8Key | undefined;
  let discontinuityGroup = 0;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      targetDuration = Number(line.split(":")[1] ?? "0") || 0;
    } else if (line.startsWith("#EXT-X-ENDLIST")) {
      isVod = true;
    } else if (line.startsWith("#EXT-X-DISCONTINUITY")) {
      discontinuityGroup++;
    } else if (line.startsWith("#EXT-X-KEY:")) {
      pendingKey = parseKey(line.slice("#EXT-X-KEY:".length));
    } else if (line.startsWith("#EXTINF:")) {
      pendingDuration = Number(line.slice(8).split(",")[0] ?? "0") || 0;
    } else if (line !== "" && !line.startsWith("#")) {
      segments.push({
        duration: pendingDuration,
        uri: line.trim(),
        discontinuityGroup,
        ...(pendingKey ? { key: pendingKey } : {}),
      });
      pendingDuration = 0;
    }
  }
  return { segments, targetDuration, isVod };
}

function parseKey(raw: string): M3u8Key {
  const attrs = parseAttributes(raw);
  return {
    method: attrs["METHOD"] ?? "NONE",
    uri: attrs["URI"] ?? "",
    ...(attrs["IV"] ? { iv: attrs["IV"] } : {}),
  };
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // 处理引号内的逗号
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  for (const char of raw) {
    if (char === '"') inQuote = !inQuote;
    if (char === "," && !inQuote) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current !== "") parts.push(current);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    attrs[key] = value;
  }
  return attrs;
}

/** 从媒体播放列表中提取唯一 key 列表。 */
export function extractUniqueKeys(media: M3u8MediaPlaylist): M3u8Key[] {
  const seen = new Set<string>();
  const keys: M3u8Key[] = [];
  for (const segment of media.segments) {
    if (!segment.key || segment.key.method === "NONE") continue;
    const id = `${segment.key.uri}|${segment.key.iv ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    keys.push(segment.key);
  }
  return keys;
}

/**
 * 构建本地化 m3u8:分片 URI 替换为本地文件名,key URI 替换为本地 key 文件名。
 * ffmpeg 读取时用 `-allowed_extensions ALL` 允许 .ts/.key 扩展名。
 */
export function buildLocalM3u8(
  media: M3u8MediaPlaylist,
  opts: {
    segmentNames: string[];
    keyUriToLocal: Map<string, string>;
  },
): string {
  const lines: string[] = ["#EXTM3U", `#EXT-X-VERSION:3`];
  if (media.targetDuration > 0) {
    lines.push(`#EXT-X-TARGETDURATION:${media.targetDuration}`);
  }
  lines.push("#EXT-X-MEDIA-SEQUENCE:0");
  lines.push("#EXT-X-PLAYLIST-TYPE:VOD");

  let lastKeyId = "";
  for (let index = 0; index < media.segments.length; index++) {
    const segment = media.segments[index]!;
    if (segment.key && segment.key.method !== "NONE") {
      const localKey = opts.keyUriToLocal.get(segment.key.uri);
      if (localKey) {
        const keyId = localKey;
        if (keyId !== lastKeyId) {
          const ivAttr = segment.key.iv ? `,IV=${segment.key.iv}` : "";
          lines.push(`#EXT-X-KEY:METHOD=AES-128,URI="${localKey}"${ivAttr}`);
          lastKeyId = keyId;
        }
      }
    }
    lines.push(`#EXTINF:${segment.duration.toFixed(3)},`);
    lines.push(opts.segmentNames[index] ?? segment.uri);
  }
  lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}
