import type { M3u8MediaPlaylist, M3u8Segment } from "./m3u8.js";

/**
 * discontinuity 分组广告过滤(Kazumi M3u8AdFilter 移植)。
 *
 * 原理:广告片段与正片之间以 #EXT-X-DISCONTINUITY 分隔,形成多个分组。
 * 取时长最长的分组为主内容,其余短分组视为广告剔除。
 * 只有一个分组时不做过滤(可能是纯正片或纯广告流)。
 */
export function filterAds(media: M3u8MediaPlaylist): M3u8MediaPlaylist {
  const segments = media.segments;
  if (segments.length === 0) return media;

  // 按 discontinuityGroup 分组
  const groups = new Map<number, M3u8Segment[]>();
  for (const segment of segments) {
    const list = groups.get(segment.discontinuityGroup) ?? [];
    list.push(segment);
    groups.set(segment.discontinuityGroup, list);
  }
  if (groups.size <= 1) return media;

  // 计算每个分组总时长
  const groupDurations = new Map<number, number>();
  for (const [groupId, list] of groups.entries()) {
    groupDurations.set(
      groupId,
      list.reduce((sum, seg) => sum + seg.duration, 0),
    );
  }

  // 最长分组为主内容
  let maxDuration = 0;
  for (const duration of groupDurations.values()) {
    if (duration > maxDuration) maxDuration = duration;
  }
  const mainGroupId = [...groupDurations.entries()].reduce((a, b) =>
    b[1] > a[1] ? b : a,
  )[0];

  const kept = segments.filter(
    (segment) => segment.discontinuityGroup === mainGroupId,
  );
  return {
    segments: kept,
    targetDuration: media.targetDuration,
    isVod: media.isVod,
  };
}

/** 过滤后的目标时长(广告分组剔除后按保留分片重算)。 */
export function calculateTargetDuration(media: M3u8MediaPlaylist): number {
  const filtered = filterAds(media);
  let max = 0;
  for (const segment of filtered.segments) {
    if (segment.duration > max) max = segment.duration;
  }
  return max;
}
