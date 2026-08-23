/**
 * UserApi 测试:账号信息、用户歌单、红心歌曲、歌单增删歌曲、歌单订阅(eapi)。
 * 全部走本地 mock 服务器;eapi 路由用 setRouteWithHeaders + 加密 body。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNeteaseClient, eapiDecrypt } from "../src/index.js";
import {
  eapiEncryptBody,
  eapiEncryptResponse,
  startMockNeteaseApi,
  type MockNeteaseApi,
} from "./helpers/mock-api.js";

const USER_ID = "8012487728";
const PLAYLIST_ID = "7618395412";
const SONG_ID = "32701996";

let mock: MockNeteaseApi;
let baseUrl = "";

beforeAll(async () => {
  mock = await startMockNeteaseApi({});
  baseUrl = mock.url;

  // 账号信息(uid 来自 profile.userId)。
  mock.setRoute("/weapi/w/nuser/account/get", () => ({
    code: 200,
    profile: { userId: Number(USER_ID), nickname: "糖糖的魔法邮票", avatarUrl: `${baseUrl}/media/avatar.jpg` },
    account: { id: Number(USER_ID) },
  }));
  // 用户歌单列表。
  mock.setRoute("/weapi/user/playlist", () => ({
    code: 200,
    playlist: [
      { id: Number(PLAYLIST_ID), name: "我喜欢的音乐", trackCount: 72, specialType: 5, subscribed: false, coverImgUrl: `${baseUrl}/media/cover.jpg`, creator: { nickname: "糖糖的魔法邮票" } },
      { id: 2002, name: "测试歌单", trackCount: 3, specialType: 0, subscribed: false },
      { id: 2003, name: "别人的歌单", trackCount: 10, specialType: 0, subscribed: true, creator: { nickname: "别人" } },
    ],
  }));
  // 红心歌曲列表。
  mock.setRoute("/weapi/song/like/get", () => ({
    code: 200,
    ids: [Number(SONG_ID), 999],
  }));
  // 红心检查。
  mock.setRoute("/weapi/song/like/check", () => ({
    code: 200,
    ids: [1, 0],
  }));
  // 红心/取消红心。
  mock.setRoute("/weapi/song/like", () => ({ code: 200 }));
  // 歌单增删歌曲。
  mock.setRoute("/weapi/playlist/manipulate/tracks", () => ({ code: 200 }));
  // 创建歌单。
  mock.setRoute("/weapi/playlist/create", () => ({
    code: 200,
    playlist: { id: 9999, name: "新歌单" },
  }));
  // 删除歌单。
  mock.setRoute("/weapi/playlist/remove", () => ({ code: 200 }));
  // 订阅/取消订阅歌单(weapi;老 eapi 路径已 404)。
  mock.setRoute("/weapi/playlist/subscribe", () => ({ code: 200 }));
  mock.setRoute("/weapi/playlist/unsubscribe", () => ({ code: 200 }));
});

afterAll(async () => {
  await mock.close();
});

function newClient() {
  return createNeteaseClient({ baseUrl });
}

describe("UserApi account", () => {
  it("returns account info with userId and nickname", async () => {
    const info = await newClient().getAccountInfo();
    expect(info.userId).toBe(USER_ID);
    expect(info.nickname).toBe("糖糖的魔法邮票");
  });
});

describe("UserApi playlists", () => {
  it("lists user playlists including the liked-music special playlist", async () => {
    const playlists = await newClient().getUserPlaylists();
    expect(playlists.length).toBe(3);
    const liked = playlists.find((p) => p.specialType === 5);
    expect(liked?.name).toBe("我喜欢的音乐");
    expect(liked?.trackCount).toBe(72);
    expect(liked?.id).toBe(PLAYLIST_ID);
  });

  it("marks subscribed playlists", async () => {
    const playlists = await newClient().getUserPlaylists();
    const subbed = playlists.find((p) => p.subscribed);
    expect(subbed?.name).toBe("别人的歌单");
    expect(subbed?.creatorName).toBe("别人");
  });
});

describe("UserApi likes", () => {
  it("returns liked song ids", async () => {
    const ids = await newClient().getLikeList();
    expect(ids).toContain(SONG_ID);
  });

  it("checks liked status in batch", async () => {
    const map = await newClient().checkLiked([SONG_ID, "999"]);
    expect(map.get(SONG_ID)).toBe(true);
    expect(map.get("999")).toBe(false);
  });

  it("likes and unlikes a song", async () => {
    await expect(newClient().likeSong(SONG_ID)).resolves.toBeUndefined();
    await expect(newClient().unlikeSong(SONG_ID)).resolves.toBeUndefined();
    // 请求已到达 /weapi/song/like 两次,且 body 为 weapi 加密 form(params/encSecKey)。
    const likeReqs = mock.requests.filter(
      (r) => r.path.startsWith("/weapi/song/like") && r.body.includes("params="),
    );
    expect(likeReqs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("UserApi playlist tracks", () => {
  it("adds tracks to a playlist", async () => {
    await expect(newClient().addTracksToPlaylist(PLAYLIST_ID, [SONG_ID, "888"])).resolves.toBeUndefined();
    const req = mock.requests.find((r) => r.path.includes("/weapi/playlist/manipulate/tracks"));
    expect(req).toBeTruthy();
    expect(req?.body).toContain("params=");
  });

  it("removes tracks from a playlist", async () => {
    await expect(newClient().removeTracksFromPlaylist(PLAYLIST_ID, [SONG_ID])).resolves.toBeUndefined();
    const req = mock.requests.filter((r) => r.path.includes("/weapi/playlist/manipulate/tracks")).at(-1);
    expect(req).toBeTruthy();
    expect(req?.body).toContain("params=");
  });

  it("rejects empty track list", async () => {
    await expect(newClient().addTracksToPlaylist(PLAYLIST_ID, [])).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });
});

describe("UserApi subscribe", () => {
  it("subscribes and unsubscribes a playlist", async () => {
    await expect(newClient().subscribePlaylist("2003")).resolves.toBeUndefined();
    await expect(newClient().unsubscribePlaylist("2003")).resolves.toBeUndefined();
    const sub = mock.requests.find((r) => r.path.includes("/weapi/playlist/subscribe"));
    const unsub = mock.requests.find((r) => r.path.includes("/weapi/playlist/unsubscribe"));
    expect(sub).toBeTruthy();
    expect(unsub).toBeTruthy();
  });
});

describe("UserApi create/delete playlist", () => {
  it("creates a playlist and returns its id", async () => {
    const id = await newClient().createPlaylist({ name: "新歌单" });
    expect(id).toBe("9999");
  });

  it("rejects empty playlist name", async () => {
    await expect(newClient().createPlaylist({ name: "  " })).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });

  it("deletes a playlist", async () => {
    await expect(newClient().deletePlaylist("9999")).resolves.toBeUndefined();
    const req = mock.requests.find((r) => r.path.includes("/weapi/playlist/remove"));
    expect(req).toBeTruthy();
    expect(req?.body).toContain("params=");
  });
});

// eapi 响应加密辅助被 setEapiRoute 使用;此处验证其可被 eapiDecrypt 还原。
describe("mock eapi helper", () => {
  it("eapiEncryptResponse round-trips through eapiDecrypt", () => {
    const encrypted = eapiEncryptResponse({ code: 200, id: 1 });
    expect(encrypted).toMatch(/^[0-9A-F]+$/u);
    expect(eapiDecrypt(encrypted)).toBe(JSON.stringify({ code: 200, id: 1 }));
  });

  it("eapiEncryptBody produces uppercase hex", () => {
    const encrypted = eapiEncryptBody("/eapi/playlist/subscribe", { code: 200 });
    expect(encrypted).toMatch(/^[0-9A-F]+$/u);
    expect(encrypted.length).toBeGreaterThan(0);
  });
});
