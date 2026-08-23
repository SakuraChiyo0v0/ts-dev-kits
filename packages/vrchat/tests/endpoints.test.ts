import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVrchatClient } from "../src/index.js";
import { FriendsApi } from "../src/endpoints/friends.js";
import { MockVrchatServer } from "./helpers/mock-vrchat-server.js";

let server: MockVrchatServer | undefined;

beforeEach(async () => {
  server = new MockVrchatServer();
  await server.start();
});

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function authedClient() {
  return createVrchatClient({
    baseUrl: server!.baseUrl,
    cookie: "auth=mock-auth-cookie-123",
  });
}

describe("users", () => {
  it("getById 返回用户", async () => {
    const client = await authedClient();
    const user = await client.users.getById("usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(user.username).toBe("alice");
    await client.close();
  });

  it("getById 不存在抛 NOT_FOUND", async () => {
    const client = await authedClient();
    await expect(client.users.getById("usr_unknown")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await client.close();
  });

  it("getProfile 返回公开资料", async () => {
    const client = await authedClient();
    const profile = await client.users.getProfile("usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(profile.username).toBe("bob");
    await client.close();
  });

  it("search 支持关键词过滤", async () => {
    const client = await authedClient();
    const all = await client.users.search({ n: 10 });
    expect(all.length).toBeGreaterThan(0);
    const none = await client.users.search({ search: "zzz-none" });
    expect(none).toHaveLength(0);
    await client.close();
  });

  it("getFriendStatus 返回好友状态", async () => {
    const client = await authedClient();
    const status = await client.users.getFriendStatus("usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(status.isFriend).toBe(true);
    await client.close();
  });

  it("getGroups / getAvatar / listActive", async () => {
    const client = await authedClient();
    const groups = await client.users.getGroups("usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(groups.length).toBeGreaterThan(0);
    const avatar = await client.users.getAvatar("usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(avatar.name).toBe("Mock Avatar");
    const active = await client.users.listActive();
    expect(active.length).toBeGreaterThan(0);
    await client.close();
  });

  it("getMutuals 共同好友", async () => {
    const client = await authedClient();
    const mutuals = await client.users.getMutuals("usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(mutuals.length).toBeGreaterThan(0);
    await client.close();
  });

  it("listNotes / createNote / updateNote / deleteNote", async () => {
    const client = await authedClient();
    const notes = await client.users.listNotes();
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]!.note).toBe("hello");

    const created = await client.users.createNote({
      targetUserId: "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
      note: "hi",
    });
    expect(created.note).toBe("hi");

    const updated = await client.users.updateNote("unote_00000000-0000-0000-0000-000000000000", "new");
    expect(updated.note).toBe("new");

    const removed = await client.users.deleteNote("unote_00000000-0000-0000-0000-000000000000");
    expect(removed.success.message).toContain("deleted");
    await client.close();
  });

  it("未登录时抛 AUTH_EXPIRED", async () => {
    const client = await createVrchatClient({ baseUrl: server!.baseUrl });
    await expect(client.users.getById("usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).rejects.toMatchObject(
      { code: "AUTH_EXPIRED" },
    );
    await client.close();
  });
});

describe("worlds", () => {
  it("getById / search / getInstances", async () => {
    const client = await authedClient();
    const world = await client.worlds.getById("wrld_00000000-0000-0000-0000-000000000000");
    expect(world.name).toBe("Mock World");
    const list = await client.worlds.search({ search: "mock", n: 5 });
    expect(list.length).toBeGreaterThan(0);
    const instances = await client.worlds.getInstances(world.id);
    expect(instances).toBeDefined();
    await client.close();
  });

  it("listFavorites / listRecent / listActive", async () => {
    const client = await authedClient();
    const favs = await client.worlds.listFavorites();
    expect(favs.length).toBeGreaterThan(0);
    const recent = await client.worlds.listRecent();
    expect(recent.length).toBeGreaterThan(0);
    const active = await client.worlds.listActive();
    expect(active.length).toBeGreaterThan(0);
    await client.close();
  });
});

describe("avatars", () => {
  it("getById / search / listOwned", async () => {
    const client = await authedClient();
    const avatar = await client.avatars.getById("avtr_00000000-0000-0000-0000-000000000001");
    expect(avatar.name).toBe("Mock Avatar");
    const list = await client.avatars.search({ featured: true, n: 5 });
    expect(list.length).toBeGreaterThan(0);
    const owned = await client.avatars.listOwned("usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(owned.length).toBeGreaterThan(0);
    await client.close();
  });

  it("文本搜索自动附带 marketplace=all", async () => {
    const client = await authedClient();
    const list = await client.avatars.search({ search: "cat", n: 5 });
    expect(list.length).toBeGreaterThan(0);
    // 显式指定 marketplace 也受支持
    const list2 = await client.avatars.search({ search: "cat", marketplace: "free", n: 5 });
    expect(list2.length).toBeGreaterThan(0);
    await client.close();
  });

  it("listFavorites 收藏头像", async () => {
    const client = await authedClient();
    const favs = await client.avatars.listFavorites();
    expect(favs.length).toBeGreaterThan(0);
    await client.close();
  });

  it("listLicensed / getStyles", async () => {
    const client = await authedClient();
    const licensed = await client.avatars.listLicensed();
    expect(licensed.length).toBeGreaterThan(0);
    await client.close();
  });

  it("getStyles 无需登录", async () => {
    const client = await createVrchatClient({ baseUrl: server!.baseUrl });
    const styles = await client.avatars.getStyles();
    expect(styles.length).toBeGreaterThan(0);
    expect(styles[0]!.name).toBe("Stylized");
    await client.close();
  });
});

describe("friends", () => {
  it("online 在线好友过滤", async () => {
    const client = await authedClient();
    const online = await client.friends.online();
    expect(online.length).toBe(1);
    expect(online[0]!.displayName).toBe("在线好友");
    // worldIdOf 解析
    const wid = FriendsApi.worldIdOf(online[0]!);
    expect(wid).toBe("wrld_00000000-0000-0000-0000-000000000000");
    await client.close();
  });
});

describe("instances", () => {
  it("getById / create", async () => {
    const client = await authedClient();
    const instance = await client.instances.getById(
      "wrld_00000000-0000-0000-0000-000000000000",
      "12345~private(usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)",
    );
    expect(instance.type).toBe("private");
    const created = await client.instances.create("wrld_00000000-0000-0000-0000-000000000000", {
      type: "private",
      region: "us",
    });
    expect(created.id).toBeDefined();
    await client.close();
  });

  it("listRecent 最近实例", async () => {
    const client = await authedClient();
    const recent = await client.instances.listRecent();
    expect(recent.length).toBeGreaterThan(0);
    await client.close();
  });

  it("getShortName 获取实例短码", async () => {
    const client = await authedClient();
    const result = await client.instances.getShortName(
      "wrld_00000000-0000-0000-0000-000000000000",
      "12345",
    );
    expect(result.shortName).toBe("8WR5X");
    await client.close();
  });
});

describe("invite", () => {
  it("invite / requestInvite / joinSelf / respond", async () => {
    const client = await authedClient();
    const invite = await client.invite.invite("usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", {
      worldId: "wrld_00000000-0000-0000-0000-000000000000",
      instanceId: "12345~private(usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)",
    });
    expect(invite.type).toBe("friendRequest");

    const req = await client.invite.requestInvite("usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", "hi");
    expect(req.id).toBeDefined();

    const self = await client.invite.joinSelf(
      "wrld_00000000-0000-0000-0000-000000000000",
      "12345~private(usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)",
    );
    expect(self.id).toBeDefined();

    const resp = await client.invite.respond("ntf_00000000-0000-0000-0000-000000000000", "yes");
    expect(resp.id).toBeDefined();
    await client.close();
  });
});

describe("friends", () => {
  it("list 返回好友列表", async () => {
    const client = await authedClient();
    const friends = await client.friends.list({ n: 10 });
    expect(friends.length).toBeGreaterThan(0);
    expect(friends[0]!.username).toBe("bob");
    await client.close();
  });
});

describe("notifications", () => {
  it("list 返回通知列表(支持类型过滤参数)", async () => {
    const client = await authedClient();
    const all = await client.notifications.list({ n: 10 });
    expect(all.length).toBeGreaterThan(0);
    expect(all[0]!.type).toBe("friendRequest");
    await client.close();
  });
});
