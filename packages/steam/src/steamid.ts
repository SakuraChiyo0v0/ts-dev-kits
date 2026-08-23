/**
 * SteamID 工具 —— steamID64 / steamID3 / steamID2 / vanity 的解析与互转。
 *
 * 关系:
 *   steamID64 = 76561197960265728 + accountId(即 0x0110000100000000 + accountId)
 *   steamID2  STEAM_<universe>:<y>:<z> 其中 accountId = z*2 + y(universe 常见 0/1)
 *   steamID3  [U:<universe>:<accountId>]
 *
 * 注意:steamID64 约 7.6e16,超出 JS Number 的 2^53 安全整数范围,
 * 所有 id64 运算一律用 BigInt,ID 以字符串表示。
 */
import { SteamError } from "./errors.js";

/** steamID64 基数(accountId 为 0 时的 steamID64)。 */
export const STEAMID64_BASE = 76561197960265728n;
/** accountId 取值范围上限(2^32)。 */
export const ACCOUNT_ID_MAX = 4294967296;
/** accountId 取值范围上限(BigInt)。 */
const ACCOUNT_ID_MAX_BIG = 4294967296n;

/** 解析结果:要么是 steamID64,要么是 vanity 名。 */
export type ParsedSteamId =
  | { kind: "steamId64"; id64: string; accountId: number }
  | { kind: "vanity"; vanity: string };

const STEAMID64_RE = /^(7656119\d{10})$/;
const STEAMID3_RE = /^\[U:(\d+):(\d+)\]$/;
const STEAMID2_RE = /^STEAM_(\d+):([01]):(\d+)$/i;
const PROFILE_URL_RE = /^https?:\/\/(?:steamcommunity\.com|localhost(?::\d+)?)\/profiles\/(7656119\d{10})\/?$/i;
const VANITY_URL_RE = /^https?:\/\/(?:steamcommunity\.com|localhost(?::\d+)?)\/id\/([A-Za-z0-9_-]+)\/?$/i;

/** 是否为合法的 17 位 steamID64 字符串。 */
export function isSteamId64(input: string): boolean {
  return STEAMID64_RE.test(input);
}

/** steamID64 → accountId。 */
export function steamId64ToAccountId(id64: string): number {
  if (!STEAMID64_RE.test(id64)) {
    throw new SteamError("INVALID_URL", `无效的 steamID64: ${id64}`);
  }
  const accountId = BigInt(id64) - STEAMID64_BASE;
  if (accountId < 0n || accountId >= ACCOUNT_ID_MAX_BIG) {
    throw new SteamError("INVALID_URL", `steamID64 超出有效范围: ${id64}`);
  }
  return Number(accountId);
}

/** steamID2(STEAM_x:y:z)→ accountId。 */
export function steamId2ToAccountId(steamId2: string): number {
  const match = STEAMID2_RE.exec(steamId2.trim());
  if (match === null) {
    throw new SteamError("INVALID_URL", `无效的 steamID2: ${steamId2}`);
  }
  const y = Number(match[2]);
  const z = Number(match[3]);
  const accountId = z * 2 + y;
  return assertAccountId(accountId, steamId2);
}

/** steamID3([U:x:y])→ accountId。 */
export function steamId3ToAccountId(steamId3: string): number {
  const match = STEAMID3_RE.exec(steamId3.trim());
  if (match === null) {
    throw new SteamError("INVALID_URL", `无效的 steamID3: ${steamId3}`);
  }
  return assertAccountId(Number(match[2]), steamId3);
}

/** accountId → steamID64。 */
export function accountIdToSteamId64(accountId: number): string {
  assertAccountId(accountId, String(accountId));
  return String(STEAMID64_BASE + BigInt(accountId));
}

/** accountId → steamID2(默认 universe 1,即 STEAM_1:y:z)。 */
export function accountIdToSteamId2(accountId: number, universe = 1): string {
  assertAccountId(accountId, String(accountId));
  const y = accountId % 2;
  const z = Math.floor(accountId / 2);
  return `STEAM_${universe}:${y}:${z}`;
}

/** accountId → steamID3(默认 universe 1)。 */
export function accountIdToSteamId3(accountId: number, universe = 1): string {
  assertAccountId(accountId, String(accountId));
  return `[U:${universe}:${accountId}]`;
}

/** steamID64 → steamID2。 */
export function steamId64ToSteamId2(id64: string, universe = 1): string {
  return accountIdToSteamId2(steamId64ToAccountId(id64), universe);
}

/** steamID64 → steamID3。 */
export function steamId64ToSteamId3(id64: string, universe = 1): string {
  return accountIdToSteamId3(steamId64ToAccountId(id64), universe);
}

/**
 * 解析输入为 steamID64 或 vanity:
 * - 17 位数字 → steamID64
 * - [U:1:12345] → steamID3
 * - STEAM_0:1:123 → steamID2
 * - steamcommunity.com/profiles/<id64> 或 /id/<vanity> URL
 * - 其余非空字符串按 vanity 名处理
 */
export function parseSteamId(input: string | number): ParsedSteamId {
  const raw = typeof input === "number" ? String(input) : input.trim();
  if (raw === "") {
    throw new SteamError("INVALID_URL", "Steam ID 输入为空");
  }

  if (STEAMID64_RE.test(raw)) {
    return { kind: "steamId64", id64: raw, accountId: steamId64ToAccountId(raw) };
  }

  const profileUrl = PROFILE_URL_RE.exec(raw);
  if (profileUrl !== null) {
    const id64 = profileUrl[1]!;
    return { kind: "steamId64", id64, accountId: steamId64ToAccountId(id64) };
  }

  const vanityUrl = VANITY_URL_RE.exec(raw);
  if (vanityUrl !== null) {
    return { kind: "vanity", vanity: vanityUrl[1]! };
  }

  const steamId3 = STEAMID3_RE.exec(raw);
  if (steamId3 !== null) {
    const accountId = assertAccountId(Number(steamId3[2]), raw);
    return { kind: "steamId64", id64: accountIdToSteamId64(accountId), accountId };
  }

  const steamId2 = STEAMID2_RE.exec(raw);
  if (steamId2 !== null) {
    const accountId = steamId2ToAccountId(raw);
    return { kind: "steamId64", id64: accountIdToSteamId64(accountId), accountId };
  }

  if (/^[A-Za-z0-9_-]{2,}$/.test(raw)) {
    return { kind: "vanity", vanity: raw };
  }

  throw new SteamError("INVALID_URL", `无法解析为 Steam ID 或 vanity: ${raw}`);
}

function assertAccountId(accountId: number, source: string): number {
  if (!Number.isInteger(accountId) || accountId < 0 || accountId >= ACCOUNT_ID_MAX) {
    throw new SteamError("INVALID_URL", `accountId 超出有效范围(来源: ${source})`);
  }
  return accountId;
}
