/**
 * 内部工具 —— 把任意 SteamIdInput 归一化为 steamID64。
 * vanity 形态需要调用 ResolveVanityURL(需 key)。
 * 不导出到公共出口。
 */
import type { SteamHttpTransport } from "./http.js";
import { SteamEndpoints } from "./endpoints.js";
import { SteamError } from "./errors.js";
import { parseSteamId } from "./steamid.js";
import type { SteamIdInput } from "./types.js";

/** 归一化为 steamID64;输入为 vanity 时自动解析(需 key,失败抛 CONFIGURATION/INVALID_URL)。 */
export async function resolveToSteamId64(
  input: SteamIdInput,
  transport: SteamHttpTransport,
): Promise<string> {
  const parsed = parseSteamId(input);
  if (parsed.kind === "steamId64") {
    return parsed.id64;
  }
  if (transport.apiKey === undefined && transport.publisherKey === undefined) {
    throw new SteamError("CONFIGURATION", `vanity "${parsed.vanity}" 需要 Steam Web API key 才能解析`);
  }
  const body = await transport.request<{
    response: { success: number; steamid?: string; message?: string };
  }>({
    host: "api",
    path: SteamEndpoints.api.resolveVanityUrl,
    params: { vanityurl: parsed.vanity, url_type: 1 },
    withKey: true,
  });
  if (body.response.success !== 1 || body.response.steamid === undefined) {
    throw new SteamError("NOT_FOUND", `vanity 未找到: ${parsed.vanity}`);
  }
  return body.response.steamid;
}
