/**
 * URL 解析:识别歌曲 / 歌单 / 专辑链接并提取 ID。
 * 支持 music.163.com 与 163cn.tv 短链(需跟随跳转)形态。
 */
import { NeteaseError } from "../errors.js";
import type { MediaType } from "../types.js";

export interface ParsedNeteaseUrl {
  type: MediaType;
  id: string;
}

const HOST_PATTERNS = [/music\.163\.com$/u, /163cn\.tv$/u];

/** 判断是否网易云音乐链接。 */
export function isNeteaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return HOST_PATTERNS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

/** 解析网易云音乐链接。 */
export function parseNeteaseUrl(input: string): ParsedNeteaseUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new NeteaseError("INVALID_URL", `无法解析链接: ${input}`);
  }
  if (!HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
    throw new NeteaseError("INVALID_URL", `不是网易云音乐链接: ${input}`);
  }

  // /song?id=123 与 /song/123 两种形态。
  const pathParts = url.pathname.split("/").filter((part) => part !== "");
  const queryId = url.searchParams.get("id");

  const resolve = (type: MediaType, id: string | null | undefined): ParsedNeteaseUrl => {
    if (id === null || id === undefined || id === "") {
      throw new NeteaseError("INVALID_URL", `链接缺少 ${type} ID: ${input}`);
    }
    if (!/^\d+$/u.test(id)) {
      throw new NeteaseError("INVALID_URL", `ID 非法: ${id}`);
    }
    return { type, id };
  };

  if (pathParts[0] === "song") {
    return resolve("song", queryId ?? pathParts[1]);
  }
  if (pathParts[0] === "playlist") {
    return resolve("playlist", queryId ?? pathParts[1]);
  }
  if (pathParts[0] === "album") {
    return resolve("album", queryId ?? pathParts[1]);
  }
  // /#/song?id=123(hash 路由形态:hash 形如 "#/song?id=123")。
  const hashRaw = url.hash.replace(/^#\/?/u, "");
  if (hashRaw !== "") {
    const [hashPath = "", hashQuery = ""] = hashRaw.split("?");
    const hashId = new URLSearchParams(hashQuery).get("id");
    const hashParts = hashPath.split("/").filter((part) => part !== "");
    if (hashParts[0] === "song") {
      return resolve("song", hashId ?? hashParts[1]);
    }
    if (hashParts[0] === "playlist") {
      return resolve("playlist", hashId ?? hashParts[1]);
    }
    if (hashParts[0] === "album") {
      return resolve("album", hashId ?? hashParts[1]);
    }
  }
  throw new NeteaseError("INVALID_URL", `不支持的网易云音乐链接类型: ${input}`);
}
