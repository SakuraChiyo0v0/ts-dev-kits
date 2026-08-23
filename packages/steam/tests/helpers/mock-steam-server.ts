/**
 * 测试用本地 mock 服务器 —— 模拟 api / store / community / login 四台主机,
 * 走真实 HTTP 协议路径(测试通过 baseUrls 覆盖指向本机)。
 * 覆盖 P0 基础设施 + P1 公开查询 + P2 登录态与登录后只读查询。
 */
import { createServer, type ServerResponse, type IncomingMessage } from "node:http";
import { generateKeyPairSync, privateDecrypt, constants } from "node:crypto";
import type { AddressInfo } from "node:net";

/** 固定测试 ID:76561198006483290(accountId 46217562)。 */
export const TEST_ID64 = "76561198006483290";
/** 固定"资料非公开"测试 ID(隐私语义断言用)。 */
export const PRIVATE_ID64 = "76561198006483291";
/** mock 账号统一密码。 */
export const MOCK_PASSWORD = "password123";
/** 通过邮箱码验证的 guard 码。 */
export const MOCK_GUARD_CODE = "12345";

export interface MockSteamServer {
  baseUrls: { api: string; store: string; community: string; login: string };
  /** 按 path 累计请求次数(用于缓存/重试断言)。 */
  hits(path: string): number;
  resetHits(): void;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

/** 读取请求体(表单/JSON)。 */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** 从 form 体解析 input_json。 */
function parseInputJson(body: string): Record<string, unknown> {
  const params = new URLSearchParams(body);
  const raw = params.get("input_json");
  if (raw === null) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface MockAuthSession {
  clientId: string;
  requestId: string;
  steamid: string;
  accountName: string;
  guard: "email" | "totp" | "device" | "none";
  polls: number;
}

/** 启动 mock 服务器,返回 baseUrls(127.0.0.1 随机端口)。 */
export async function startMockSteamServer(): Promise<MockSteamServer> {
  const hits = new Map<string, number>();
  let rateLimitOnce = true;

  const count = (path: string): void => {
    hits.set(path, (hits.get(path) ?? 0) + 1);
  };

  // 登录协议 mock 状态(密码 RSA 密钥对 + 认证会话表)。
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const publicKeyMod = Buffer.from(publicJwk.n, "base64url").toString("hex");
  const publicKeyExp = Buffer.from(publicJwk.e, "base64url").toString("hex");
  const authSessions = new Map<string, MockAuthSession>();
  let authCounter = 0;

  // mock 的 refresh_token 使用伪 JWT(含 sub=steamid),贴近真实协议。
  const mockRefreshToken = (serial: number): string =>
    [
      Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ sub: TEST_ID64, aud: ["web"] })).toString("base64url"),
      `sig-${serial}`,
    ].join(".");

  const createAuthSession = (guard: MockAuthSession["guard"], accountName: string): MockAuthSession => {
    authCounter += 1;
    const session: MockAuthSession = {
      clientId: `cid-${authCounter}`,
      requestId: Buffer.from(`req-${authCounter}`).toString("base64"),
      steamid: TEST_ID64,
      accountName,
      guard,
      polls: 0,
    };
    authSessions.set(session.clientId, session);
    return session;
  };

  const decryptPassword = (encryptedPassword64: string): string => {
    try {
      return privateDecrypt(
        { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
        Buffer.from(encryptedPassword64, "base64"),
      ).toString("utf8");
    } catch {
      return "";
    }
  };

  /* ---------------- api.steampowered.com ---------------- */
  const api = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    count(url.pathname);
    const query = url.searchParams;
    const bodyText = await readBody(req);

    const withPlayers = (players: unknown[]): void => {
      const ids = (query.get("steamids") ?? "").split(",").filter(Boolean);
      send(res, 200, {
        response: {
          players:
            players.length > 0
              ? players
              : ids.map((id, index) => ({
                  steamid: id,
                  communityvisibilitystate: id === PRIVATE_ID64 ? 1 : 3,
                  personaname: `Player${index}`,
                  profileurl: `https://steamcommunity.com/profiles/${id}/`,
                  avatar: "",
                  avatarmedium: "",
                  avatarfull: "",
                  personastate: 1,
                })),
        },
      });
    };

    switch (url.pathname) {
      /* ---- P0 ---- */
      case "/ISteamWebAPIUtil/GetServerInfo/v1/":
        // 与真实接口一致:GetServerInfo 返回顶层字段,无 response 包装。
        send(res, 200, { servertime: 1700000000, servertimestring: "test" });
        return;
      case "/ISteamWebAPIUtil/GetSupportedAPIList/v1/":
        if (!["TEST_KEY", "PUB_KEY"].includes(req.headers["x-webapi-key"] as string)) {
          send(res, 401, { error: "Access is denied" });
          return;
        }
        send(res, 200, { apilist: { interfaces: [{ name: "ISteamApps", methods: [] }] } });
        return;
      case "/echo":
        send(res, 200, {
          query: Object.fromEntries(query.entries()),
          headers: {
            "x-webapi-key": req.headers["x-webapi-key"] ?? null,
            cookie: req.headers.cookie ?? null,
          },
        });
        return;
      case "/rate-limit-once":
        if (rateLimitOnce) {
          rateLimitOnce = false;
          send(res, 429, { error: "rate limited" }, { "retry-after": "1" });
        } else {
          send(res, 200, { ok: true });
        }
        return;
      case "/rate-limit-always":
        send(res, 429, { error: "rate limited" }, { "retry-after": "2" });
        return;
      case "/cacheable":
        send(res, 200, { value: Number(query.get("v") ?? "0") });
        return;
      case "/slow":
        // 永不响应,留给客户端超时
        return;

      /* ---- P1 玩家 ---- */
      case "/ISteamUser/GetPlayerSummaries/v2/":
        withPlayers([]);
        return;
      case "/ISteamUser/ResolveVanityURL/v1/":
        if (query.get("vanityurl") === "nouser") {
          send(res, 200, { response: { success: 42, message: "No match" } });
        } else {
          send(res, 200, { response: { success: 1, steamid: TEST_ID64 } });
        }
        return;
      case "/ISteamUser/GetPlayerBans/v1/":
        send(res, 200, {
          players: [
            {
              SteamId: TEST_ID64,
              CommunityBanned: false,
              VACBanned: true,
              NumberOfVACBans: 2,
              DaysSinceLastBan: 100,
              NumberOfGameBans: 1,
              EconomyBan: "none",
            },
          ],
        });
        return;
      case "/IPlayerService/GetOwnedGames/v1/":
        if (query.get("steamid") === PRIVATE_ID64) {
          send(res, 200, { response: { game_count: 0, games: [] } });
        } else {
          send(res, 200, {
            response: {
              game_count: 1,
              games: [
                {
                  appid: 440,
                  name: "Team Fortress 2",
                  playtime_forever: 100,
                  img_icon_url: "ic",
                  has_community_visible_stats: true,
                },
              ],
            },
          });
        }
        return;
      case "/IPlayerService/IsPlayingSharedGame/v1/":
        send(res, 200, { response: { lender_steamid: TEST_ID64 } });
        return;

      /* ---- P1 统计 ---- */
      case "/ISteamUserStats/GetSchemaForGame/v2/":
        send(res, 200, {
          game: {
            gameName: "Team Fortress 2",
            gameVersion: "1.0",
            availableGameStats: {
              achievements: [
                { name: "a1", defaultvalue: 0, displayName: "A1", hidden: 0, description: "d", icon: "i", icongray: "g" },
              ],
              stats: [{ name: "s1", defaultvalue: 0, displayName: "S1" }],
            },
          },
        });
        return;
      case "/ISteamUserStats/GetPlayerAchievements/v1/":
        if (query.get("steamid") === PRIVATE_ID64) {
          send(res, 200, { playerstats: { success: false, error: "Requested profile has no game statistics" } });
        } else {
          send(res, 200, {
            playerstats: {
              steamID: TEST_ID64,
              gameName: "Team Fortress 2",
              achievements: [{ apiname: "a1", achieved: 1, unlocktime: 1700000000 }],
              success: true,
            },
          });
        }
        return;
      case "/ISteamUserStats/GetUserStatsForGame/v2/":
        send(res, 200, {
          playerstats: {
            steamID: TEST_ID64,
            gameName: "Team Fortress 2",
            achievements: [],
            stats: [{ name: "total_kills", value: 5 }],
            success: true,
          },
        });
        return;
      case "/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/":
        send(res, 200, { achievementpercentages: { achievements: [{ name: "a1", percent: 50.5 }] } });
        return;
      case "/ISteamUserStats/GetGlobalStatsForGame/v1/":
        send(res, 200, { response: { globalstats: { total_kills: { total: 100 } } } });
        return;
      case "/ISteamUserStats/GetNumberOfCurrentPlayers/v1/":
        send(res, 200, { response: { player_count: 12345, result: 1 } });
        return;

      /* ---- P1 新闻 / 应用 ---- */
      case "/ISteamNews/GetNewsForApp/v2/":
        send(res, 200, {
          appnews: {
            appid: 440,
            newsitems: [
              {
                gid: "1",
                title: "Update",
                url: "https://example.com/news",
                is_external_url: false,
                author: "valve",
                contents: "hello",
                feedlabel: "News",
                date: 1700000000,
                feedname: "steam_community_announcements",
                appid: 440,
              },
            ],
            count: 1,
          },
        });
        return;
      case "/ISteamApps/GetAppList/v2/":
        send(res, 200, { applist: { apps: [{ appid: 440, name: "Team Fortress 2" }] } });
        return;

      /* ---- P2 玩家深水区(仅 key) ---- */
      case "/ISteamUser/GetFriendList/v1/":
        if (query.get("steamid") === PRIVATE_ID64) {
          send(res, 403, { error: "Forbidden: profile is private" });
        } else {
          send(res, 200, {
            friendslist: {
              friends: [{ steamid: "76561198006483292", relationship: "friend", friends_since: 1600000000 }],
            },
          });
        }
        return;
      case "/ISteamUser/GetUserGroupList/v1/":
        send(res, 200, { response: { success: true, groups: [{ gid: "103582791433293646" }] } });
        return;
      case "/IPlayerService/GetSteamLevel/v1/":
        send(res, 200, { response: { player_level: 42 } });
        return;
      case "/IPlayerService/GetBadges/v1/":
        send(res, 200, {
          response: {
            badges: [{ badgeid: 1, level: 1, completion_time: 0, xp: 100, scarcity: 0 }],
            player_xp: 1000,
            player_level: 42,
            player_xp_needed_to_current_level: 900,
            player_xp_needed_to_next_level: 1100,
          },
        });
        return;
      case "/IPlayerService/GetCommunityBadgeProgress/v1/":
        send(res, 200, {
          response: {
            badgeid: 1,
            quests: [
              { questid: 101, completed: true },
              { questid: 102, completed: false },
            ],
          },
        });
        return;
      case "/IPlayerService/GetRecentlyPlayedGames/v1/":
        send(res, 200, {
          response: {
            total_count: 1,
            games: [{ appid: 440, name: "Team Fortress 2", playtime_2weeks: 60, playtime_forever: 100, img_icon_url: "ic" }],
          },
        });
        return;

      /* ---- P2 创意工坊 ---- */
      case "/ISteamRemoteStorage/GetPublishedFileDetails/v1/": {
        const params = new URLSearchParams(bodyText);
        const ids: string[] = [];
        for (let i = 0; i < Number(params.get("itemcount") ?? 0); i += 1) {
          const id = params.get(`publishedfileids[${i}]`);
          if (id !== null) {
            ids.push(id);
          }
        }
        send(res, 200, {
          response: {
            result: 1,
            resultcount: ids.length,
            publishedfiledetails: ids.map((id) => ({
              publishedfileid: id,
              creator: TEST_ID64,
              title: `Mod ${id}`,
              file_size: 100,
            })),
          },
        });
        return;
      }
      case "/ISteamRemoteStorage/EnumerateUserPublishedFiles/v1/":
      case "/ISteamRemoteStorage/EnumerateUserSubscribedFiles/v1/":
        send(res, 200, {
          response: {
            total: 1,
            publishedfiledetails: [
              { publishedfileid: "1", filename: "a.vpk", file_size: 100, time_created: 1600000000, time_updated: 1600000001 },
            ],
          },
        });
        return;

      /* ---- P2 登录协议(IAuthenticationService) ---- */
      case "/IAuthenticationService/GetPasswordRSAPublicKey/v1/":
        send(res, 200, {
          response: {
            publickey_mod: publicKeyMod,
            publickey_exp: publicKeyExp,
            timestamp: "1700000000",
          },
        });
        return;
      case "/IAuthenticationService/BeginAuthSessionViaCredentials/v1/": {
        const input = parseInputJson(bodyText);
        const accountName = String(input.account_name ?? "");
        const decrypted = decryptPassword(String(input.encrypted_password ?? ""));
        if (decrypted !== MOCK_PASSWORD) {
          send(res, 200, { response: {} }, { "x-eresult": "5" });
          return;
        }
        let guard: MockAuthSession["guard"] = "none";
        if (accountName === "needs2fa") guard = "email";
        if (accountName === "totp2fa") guard = "totp";
        if (accountName === "device2fa") guard = "device";
        const session = createAuthSession(guard, accountName);
        const confirmations =
          guard === "email"
            ? [{ confirmation_type: 2, associated_message: "email code sent" }]
            : guard === "totp"
              ? [{ confirmation_type: 3, associated_message: "enter totp" }]
              : guard === "device"
                ? [{ confirmation_type: 4, associated_message: "approve in mobile app" }]
                : [];
        send(res, 200, {
          response: {
            client_id: session.clientId,
            request_id: session.requestId,
            interval: 1,
            allowed_confirmations: confirmations,
            steamid: session.steamid,
            weak_token: "weak",
          },
        });
        return;
      }
      case "/IAuthenticationService/UpdateAuthSessionWithSteamGuardCode/v1/": {
        const input = parseInputJson(bodyText);
        if (String(input.code ?? "") !== MOCK_GUARD_CODE) {
          send(res, 200, { response: {} }, { "x-eresult": "25" });
          return;
        }
        const session = authSessions.get(String(input.client_id ?? ""));
        if (session !== undefined && (session.guard === "email" || session.guard === "totp")) {
          session.guard = "none"; // 验证码通过后直接轮询拿令牌
        }
        send(res, 200, { response: {} });
        return;
      }
      case "/IAuthenticationService/BeginAuthSessionViaQR/v1/": {
        const session = createAuthSession("device", "qr-user");
        send(res, 200, {
          response: {
            client_id: session.clientId,
            request_id: session.requestId,
            interval: 1,
            challenge_url: "steam://mobileauth/abc123",
            version: 1,
          },
        });
        return;
      }
      case "/IAuthenticationService/PollAuthSessionStatus/v1/": {
        const input = parseInputJson(bodyText);
        const session = authSessions.get(String(input.client_id ?? ""));
        if (session === undefined) {
          send(res, 200, { response: {} }, { "x-eresult": "7" });
          return;
        }
        session.polls += 1;
        if (session.guard === "device" && session.polls < 2) {
          send(res, 200, { response: { had_remote_interaction: true } });
          return;
        }
        send(res, 200, {
          response: {
            access_token: `access-${session.polls}`,
            refresh_token: mockRefreshToken(session.polls),
            account_name: session.accountName,
          },
        });
        return;
      }
      case "/IAuthenticationService/GetAuthSessionInfo/v1/":
        send(res, 200, {
          response: {
            ip: "1.2.3.4",
            geoloc: "CN",
            city: "Shanghai",
            state: "31",
            platform_type: 2,
            device_friendly_name: "mock",
            version: 1,
            login_history: 0,
            requestor_location_mismatch: false,
            high_usage_login: false,
            requested_persistence: 1,
          },
        });
        return;
      case "/IAuthenticationService/GenerateAccessTokenForApp/v1/": {
        const input = parseInputJson(bodyText);
        const renewal = Number(input.renewal_type ?? 0) === 1;
        send(res, 200, {
          response: {
            access_token: "access-refreshed",
            ...(renewal ? { refresh_token: "refresh-renewed" } : {}),
          },
        });
        return;
      }

      /* ---- P3:物品定义(publisher key)与交易只读 ---- */
      case "/ISteamInventory/GetItemDefs/v1/":
        if (req.headers["x-webapi-key"] !== "PUB_KEY") {
          send(res, 401, { error: "Access is denied" });
          return;
        }
        send(res, 200, {
          result: [
            {
              appid: 440,
              itemdefid: 1,
              name: "Test Item",
              marketable: true,
              tradable: true,
              price_category: "VLV100;VLV25",
            },
          ],
        });
        return;
      case "/IEconService/GetTradeOffers/v1/": {
        if (!["TEST_KEY", "PUB_KEY"].includes(req.headers["x-webapi-key"] as string)) {
          send(res, 401, { error: "Access is denied" });
          return;
        }
        const getSent = query.get("get_sent_offers") !== "0";
        const getReceived = query.get("get_received_offers") !== "0";
        send(res, 200, {
          response: {
            ...(getSent
              ? {
                  trade_offers_sent: [
                    {
                      tradeofferid: "101",
                      accountid_other: 123,
                      message: "hi",
                      expiration_time: 0,
                      trade_offer_state: 2,
                      is_our_offer: true,
                      time_created: 1700000000,
                      time_updated: 1700000001,
                      from_real_time_trade: false,
                      items_to_give: [
                        {
                          appid: 440,
                          contextid: "2",
                          assetid: "1001",
                          amount: "1",
                          classid: "c1",
                          instanceid: "0",
                          market_hash_name: "Test Item",
                        },
                      ],
                    },
                  ],
                }
              : {}),
            ...(getReceived
              ? {
                  trade_offers_received: [
                    {
                      tradeofferid: "102",
                      accountid_other: 456,
                      message: "",
                      expiration_time: 0,
                      trade_offer_state: 2,
                      is_our_offer: false,
                      time_created: 1700000100,
                      time_updated: 1700000101,
                      from_real_time_trade: false,
                      items_to_receive: [
                        {
                          appid: 570,
                          contextid: "2",
                          assetid: "2001",
                          amount: "1",
                          classid: "c2",
                          instanceid: "0",
                          market_hash_name: "Dota Item",
                        },
                      ],
                    },
                  ],
                }
              : {}),
            descriptions: {},
          },
        });
        return;
      }
      case "/IEconService/GetTradeOffer/v1/": {
        if (!["TEST_KEY", "PUB_KEY"].includes(req.headers["x-webapi-key"] as string)) {
          send(res, 401, { error: "Access is denied" });
          return;
        }
        send(res, 200, {
          response: {
            offer: {
              tradeofferid: query.get("tradeofferid") ?? "0",
              accountid_other: 123,
              message: "single",
              expiration_time: 0,
              trade_offer_state: 2,
              is_our_offer: true,
              time_created: 1700000000,
              time_updated: 1700000001,
              from_real_time_trade: false,
            },
          },
        });
        return;
      }
      case "/IEconService/GetTradeHistory/v1/": {
        if (!["TEST_KEY", "PUB_KEY"].includes(req.headers["x-webapi-key"] as string)) {
          send(res, 401, { error: "Access is denied" });
          return;
        }
        send(res, 200, {
          response: {
            trades: [
              {
                tradeid: "9001",
                steamid_other: "76561198006483292",
                time_init: 1700000200,
                status: 3,
                assets_given: [
                  {
                    appid: 440,
                    contextid: "2",
                    assetid: "1001",
                    amount: "1",
                    classid: "c1",
                    instanceid: "0",
                  },
                ],
              },
            ],
            more: false,
          },
        });
        return;
      }

      default:
        send(res, 404, { error: "not found" });
    }
  });

  /* ---------------- store.steampowered.com ---------------- */
  const store = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    count(url.pathname);
    const bodyText = await readBody(req);
    switch (url.pathname) {
      case "/api/appdetails":
        send(res, 200, {
          "440": {
            success: true,
            data: {
              name: "Team Fortress 2",
              steam_appid: 440,
              is_free: true,
              price_overview: { currency: "CNY", initial: 100, final: 80 },
            },
          },
        });
        return;
      case "/api/featured":
        send(res, 200, {
          large_capsules: [],
          featured_win: [{ id: 440, name: "Team Fortress 2", small_capsule_image: "x" }],
          featured_mac: [],
          featured_linux: [],
        });
        return;
      case "/api/featuredcategories":
        send(res, 200, { "0": { id: "cat1", name: "Category", items: [] } });
        return;
      case "/api/packagedetails":
        send(res, 200, {
          "111": { success: true, data: { name: "Pkg", price: { currency: "USD", initial: 99, final: 49 } } },
        });
        return;
      case "/api/dlcforapp":
        send(res, 200, { success: true, dlc: [629330] });
        return;
      case "/api/storesearch":
        send(res, 200, {
          total: 1,
          items: [{ type: "app", name: "Team Fortress 2", id: 440, tiny_image: "x", price: { final: 0 } }],
        });
        return;
      case "/api/getappsincategory":
        send(res, 200, { success: true, name: "Category", apps: [{ id: 440, name: "Team Fortress 2" }] });
        return;
      case "/api/getappsingenre":
        send(res, 200, { success: true, name: "Genre", apps: [{ id: 440, name: "Team Fortress 2" }] });
        return;
      case "/api/salepage":
        send(res, 200, { success: true, name: "Sale" });
        return;
      case "/api/appreviews":
      case "/appreviews/440":
        send(res, 200, {
          success: 1,
          query_summary: {
            num_reviews: 2,
            review_score: 9,
            review_score_desc: "Overwhelmingly Positive",
            total_positive: 2,
            total_negative: 0,
            total_reviews: 2,
          },
          reviews: [
            {
              recommendationid: "r1",
              author: {
                steamid: "76561198006483292",
                num_games_owned: 10,
                num_reviews: 3,
                playtime_forever: 500,
                playtime_at_review: 100,
                last_played: 1700000000,
              },
              language: "schinese",
              review: "好玩",
              timestamp_created: 1700000000,
              timestamp_updated: 1700000000,
              voted_up: true,
              votes_up: 5,
              votes_funny: 1,
              weighted_vote_score: 0.8,
              comment_count: 2,
              steam_purchase: true,
              received_for_free: false,
              written_during_early_access: false,
            },
            {
              recommendationid: "r2",
              author: {
                steamid: "76561198006483293",
                num_games_owned: 20,
                num_reviews: 5,
                playtime_forever: 1000,
                playtime_at_review: 300,
                last_played: 1700000100,
              },
              language: "english",
              review: "great",
              timestamp_created: 1700000100,
              timestamp_updated: 1700000100,
              voted_up: true,
              votes_up: 8,
              votes_funny: 0,
              weighted_vote_score: 0.9,
              comment_count: 1,
              steam_purchase: true,
              received_for_free: false,
              written_during_early_access: false,
            },
          ],
          cursor: "AoIIP34DCw==",
        });
        return;
      case "/account/registerkey": {
        if (req.method === "POST") {
          // 兑换提交由 ajaxregisterkey 处理;这里只服务 GET 页面。
          send(res, 404, { error: "not found" });
          return;
        }
        const cookie = req.headers.cookie ?? "";
        if (!cookie.includes("browserid")) {
          // 模拟真实 store 会话刷新:首访 302 + Set-Cookie(browserid)。
          res.writeHead(302, {
            location: "/account/registerkey",
            "set-cookie": "browserid=123456; Path=/; Secure",
          });
          res.end();
          return;
        }
        if (!cookie.includes("steamLoginSecure")) {
          res.writeHead(302, { location: "/login/" });
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end('<html><body><script type="text/javascript">sessionID = "mocksession123";</script></body></html>');
        return;
      }
      case "/account/ajaxregisterkey/": {
        const cookie = req.headers.cookie ?? "";
        if (!cookie.includes("steamLoginSecure")) {
          send(res, 401, { error: "login required" });
          return;
        }
        const params = new URLSearchParams(bodyText);
        const productKey = params.get("product_key") ?? "";
        if (productKey === "GOOD-KEY-1234") {
          send(res, 200, {
            success: 1,
            purchase_receipt_info: {
              transactionid: "123",
              packageid: 440,
              purchase_status: 1,
              result_detail: 1,
              transaction_time: 1700000000,
              payment_method: 1,
              base_price: "0",
              total_discount: "0",
              tax: "0",
              shipping: "0",
              currency_code: 23,
              country_code: "CN",
              error_headline: "",
              error_string: "",
              error_link_text: "",
              error_link_url: "",
              error_appid: 0,
              line_items: [{ line_item_description: "Team Fortress 2" }],
            },
          });
          return;
        }
        send(res, 200, {
          success: 2,
          purchase_result_details: 14,
          purchase_receipt_info: {
            transactionid: "18446744073709551615",
            packageid: 4294967295,
            purchase_status: 2,
            result_detail: 14,
            transaction_time: 1700000000,
            payment_method: 1,
            base_price: "0",
            total_discount: "0",
            tax: "0",
            shipping: "0",
            currency_code: 0,
            country_code: "",
            error_headline: "",
            error_string: "",
            error_link_text: "",
            error_link_url: "",
            error_appid: 0,
            line_items: [],
          },
          rwgrsn: -2,
        });
        return;
      }
      default:
        send(res, 404, { error: "not found" });
    }
  });

  /* ---------------- steamcommunity.com ---------------- */
  const community = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    count(url.pathname);
    const bodyText = await readBody(req);

    if (url.pathname === "/echo") {
      send(res, 200, { headers: { cookie: req.headers.cookie ?? null } });
      return;
    }
    if (url.pathname === "/market/itemordershistogram") {
      const params = new URLSearchParams(bodyText);
      if (params.get("market_hash_name") === "UNKNOWN ITEM") {
        send(res, 200, { success: false, sell_order_graph: [], buy_order_graph: [] });
        return;
      }
      send(res, 200, {
        success: true,
        sell_order_graph: [
          [1.8, 5],
          [1.9, 8],
        ],
        sell_order_summary: "13 available",
        buy_order_graph: [
          [1.5, 4],
          [1.4, 6],
        ],
        buy_order_summary: "10 buy orders",
        highest_buy_order: 1.5,
        lowest_sell_order: 1.8,
        buy_order_count: 10,
        sell_order_count: 13,
      });
      return;
    }
    if (url.pathname === "/market/pricehistory/") {
      send(res, 200, {
        success: true,
        prices: [
          [1700000000, 1.5, 10],
          [1700000100, 1.6, 12],
          [1700000200, 1.55, 9],
        ],
      });
      return;
    }
    if (url.pathname === "/market/mylistings/" || url.pathname === "/market/myhistory/") {
      const cookie = req.headers.cookie ?? "";
      if (!cookie.includes("steamLoginSecure")) {
        send(res, 401, { success: false });
        return;
      }
      if (url.pathname === "/market/mylistings/") {
        send(res, 200, {
          success: true,
          total_count: 1,
          listings: [
            {
              listingid: "l1",
              appid: 730,
              market_hash_name: "AK-47 | Redline (Field-Tested)",
              price: 100,
              currencyid: 23,
              time_created: 1700000000,
              asset: {
                appid: 730,
                contextid: "2",
                id: "1001",
                amount: "1",
                market_fee_app: 730,
              },
            },
          ],
        });
      } else {
        send(res, 200, {
          success: true,
          total_count: 1,
          events: [
            {
              event_type: "sale",
              time_event: 1700000100,
              asset: { appid: 730, contextid: "2", id: "2001", amount: "1", market_hash_name: "AK-47 | Redline (Field-Tested)" },
              price: 90,
              currencyid: 23,
              total_price: 90,
            },
          ],
        });
      }
      return;
    }
    if (url.pathname === "/tradeoffer/new/") {
      const cookie = req.headers.cookie ?? "";
      if (!cookie.includes("steamLoginSecure")) {
        send(res, 401, { error: "login required" });
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<html><body><script>g_strTradeOfferAccessToken = "mocktoken123456";</script></body></html>');
      return;
    }
    const profileXmlMatch = /^\/profiles\/(\d+)\/$/.exec(url.pathname);
    if (profileXmlMatch !== null && url.searchParams.get("xml") === "1") {
      if (profileXmlMatch[1] === PRIVATE_ID64) {
        res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
        res.end("<profile><steamID64>76561198006483291</steamID64></profile>");
        return;
      }
      res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
      res.end(
        [
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
          "<profile>",
          `  <steamID64>${profileXmlMatch[1]}</steamID64>`,
          "  <steamID>Player1</steamID>",
          "  <recentActivity>",
          "    <activity>",
          "      <eventType>12</eventType>",
          "      <gameID>440</gameID>",
          "      <webLink>https://store.steampowered.com/app/440/</webLink>",
          "      <steamLink>steam://store/440</steamLink>",
          "      <unixTime>1700000000</unixTime>",
          "    </activity>",
          "    <activity>",
          "      <eventType>53</eventType>",
          "      <gameID>440</gameID>",
          "      <webLink>https://steamcommunity.com/id/demo</webLink>",
          "      <steamLink>steam://url/CommunityFilePage/1</steamLink>",
          "      <unixTime>1700000100</unixTime>",
          "    </activity>",
          "  </recentActivity>",
          "</profile>",
        ].join("\n"),
      );
      return;
    }
    const commentMatch = /^\/comment\/Profile\/render\/(\d+)\//.exec(url.pathname);
    if (commentMatch !== null) {
      if (commentMatch[1] === PRIVATE_ID64) {
        send(res, 200, { success: true, total_count: 0, comments_html: "[]" });
        return;
      }
      send(res, 200, {
        success: true,
        total_count: 2,
        comments_html: JSON.stringify([
          {
            commentid: "c1",
            author: { steamid: "76561198006483292", personaname: "Friend1", avatar: "x" },
            timestamp: 1700000000,
            text: "nice profile",
          },
          {
            commentid: "c2",
            author: { steamid: TEST_ID64, personaname: "Player1", avatar: "y" },
            timestamp: 1700000100,
            text: "thanks",
          },
        ]),
        timestep: 1,
      });
      return;
    }
    if (url.pathname.startsWith("/inventory/")) {
      const match = /^\/inventory\/(\d+)\/(\d+)\/(\d+)/.exec(url.pathname);
      if (match === null) {
        send(res, 404, { error: "bad inventory path" });
        return;
      }
      const steamid = match[1]!;
      if (steamid === PRIVATE_ID64) {
        send(res, 200, { assets: [], descriptions: [], success: 1, total_inventory_count: 0 });
        return;
      }
      send(res, 200, {
        assets: [
          { appid: Number(match[2]), contextid: match[3], assetid: "1001", classid: "c1", instanceid: "0", amount: "1" },
        ],
        descriptions: [
          {
            appid: Number(match[2]),
            classid: "c1",
            instanceid: "0",
            name: "Test Item",
            type: "Test",
            market_name: "Test Item",
            market_hash_name: "Test Item",
            marketable: 1,
            tradable: 1,
            tags: [{ category: "Game", internal_name: `app_${match[2]}`, localized_category_name: "Game", localized_tag_name: "Steam" }],
          },
        ],
        more_items: 0,
        total_inventory_count: 1,
        success: 1,
      });
      return;
    }
    if (url.pathname === "/market/priceoverview/") {
      if (url.searchParams.get("market_hash_name") === "UNKNOWN ITEM") {
        send(res, 200, { success: false });
        return;
      }
      send(res, 200, { success: true, lowest_price: "$1.00", volume: "100", median_price: "$1.50" });
      return;
    }
    if (url.pathname === "/market/search/render") {
      send(res, 200, {
        success: true,
        start: 0,
        pagesize: 10,
        total_count: 2,
        results: [
          { name: "A", hash_name: "A", sell_listings: 1, sell_price: 100, sell_price_text: "$1.00" },
          { name: "B", hash_name: "B", sell_listings: 2, sell_price: 200, sell_price_text: "$2.00" },
        ],
      });
      return;
    }
    const wishlistMatch = /^\/wishlist\/profiles\/(\d+)\/wishlistdata/.exec(url.pathname);
    if (wishlistMatch !== null) {
      if (wishlistMatch[1] === PRIVATE_ID64) {
        send(res, 403, { success: false });
        return;
      }
      if (wishlistMatch[1] === "76561198006483293") {
        // 模拟 community 对私密/被风控愿望单返回通用 HTML 页(而非 JSON)。
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<!DOCTYPE html><html><body><a href=\"/login\">Sign In</a></body></html>");
        return;
      }
      send(res, 200, {
        "440": { name: "Team Fortress 2", capsule: "x", type: "game" },
        "570": { name: "Dota 2", capsule: "y", type: "game" },
      });
      return;
    }
    send(res, 404, { error: "not found" });
  });

  /* ---------------- login.steampowered.com ---------------- */
  // loginBase 在服务器启动后赋值;请求处理在启动之后发生,闭包内使用安全。
  let loginBase = "";
  const login = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    count(url.pathname);
    const bodyText = await readBody(req);
    const params = new URLSearchParams(bodyText);
    if (url.pathname === "/jwt/finalizelogin") {
      const nonce = params.get("nonce") ?? "";
      if (!nonce.startsWith("eyJ")) {
        send(res, 200, { error: 9 });
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "steamRefresh_steam=refresh-1; Path=/; Secure; Domain=login.steampowered.com",
      });
      res.end(
        JSON.stringify({
          steamID: TEST_ID64,
          redir: "https://steamcommunity.com/login/home/?goto=",
          transfer_info: [{ url: `${loginBase}/jwt/setcookie`, params: { nonce: "n1", auth: "a1" } }],
        }),
      );
      return;
    }
    if (url.pathname === "/jwt/setcookie") {
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "steamLoginSecure=abc123%7C%7Ctoken; Path=/; Secure; SameSite=None",
      });
      res.end(JSON.stringify({ result: 1 }));
      return;
    }
    send(res, 404, { error: "not found" });
  });

  const listen = (server: ReturnType<typeof createServer>): Promise<void> =>
    new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  await Promise.all([listen(api), listen(store), listen(community), listen(login)]);

  const port = (server: ReturnType<typeof createServer>): number =>
    (server.address() as AddressInfo).port;

  const baseUrls = {
    api: `http://127.0.0.1:${port(api)}`,
    store: `http://127.0.0.1:${port(store)}`,
    community: `http://127.0.0.1:${port(community)}`,
    login: `http://127.0.0.1:${port(login)}`,
  };
  loginBase = baseUrls.login;

  return {
    baseUrls,
    hits: (path: string) => hits.get(path) ?? 0,
    resetHits: () => hits.clear(),
    close: async () => {
      for (const server of [api, store, community, login]) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  };
}
