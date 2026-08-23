import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVrchatClient } from "../src/index.js";
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

describe("friends 写操作", () => {
  it("sendRequest 发送好友请求", async () => {
    const client = await authedClient();
    const result = await client.friends.sendRequest("usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(result.success.message).toContain("Friend request");
    await client.close();
  });

  it("delete 删除好友", async () => {
    const client = await authedClient();
    const result = await client.friends.delete("usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(result.success.message).toContain("Friend deleted");
    await client.close();
  });
});

describe("notifications 写操作", () => {
  it("accept 接受通知(好友请求)", async () => {
    const client = await authedClient();
    const updated = await client.notifications.accept("ntf_00000000-0000-0000-0000-000000000000");
    expect(updated.seen).toBe(true);
    await client.close();
  });

  it("hide 隐藏/拒绝通知", async () => {
    const client = await authedClient();
    const updated = await client.notifications.hide("ntf_00000000-0000-0000-0000-000000000000");
    expect(updated.seen).toBe(true);
    await client.close();
  });

  it("getById / reply", async () => {
    const client = await authedClient();
    const one = await client.notifications.getById("ntf_00000000-0000-0000-0000-000000000000");
    expect(one.id).toBeDefined();
    const replied = await client.notifications.reply("ntf_00000000-0000-0000-0000-000000000000", "hello!");
    expect(replied.id).toBeDefined();
    await client.close();
  });

  it("markSeen 标记已读", async () => {
    const client = await authedClient();
    const updated = await client.notifications.markSeen("ntf_00000000-0000-0000-0000-000000000000");
    expect(updated.seen).toBe(true);
    await client.close();
  });

  it("clear 清除所有通知", async () => {
    const client = await authedClient();
    const result = await client.notifications.clear();
    expect(result.success.message).toContain("cleared");
    await client.close();
  });
});

describe("favorites", () => {
  it("list / add / remove", async () => {
    const client = await authedClient();
    const list = await client.favorites.list({ type: "avatar", n: 10 });
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.type).toBe("avatar");

    const added = await client.favorites.add({
      type: "avatar",
      favoriteId: "avtr_00000000-0000-0000-0000-000000000001",
      tags: ["avatars_1"],
    });
    expect(added.id).toBeDefined();

    const removed = await client.favorites.remove("fvrt_00000000-0000-0000-0000-000000000000");
    expect(removed.success.message).toContain("removed");
    await client.close();
  });

  it("listGroups / createGroup / deleteGroup", async () => {
    const client = await authedClient();
    const groups = await client.favorites.listGroups("avatar");
    expect(groups.length).toBeGreaterThan(0);

    const created = await client.favorites.createGroup({ type: "avatar", name: "avatars_2" });
    expect(created.id).toBeDefined();

    const removed = await client.favorites.deleteGroup("fvrtgrp_00000000-0000-0000-0000-000000000000");
    expect(removed.success.message).toContain("deleted");
    await client.close();
  });

  it("getByGroup 按分组获取收藏", async () => {
    const client = await authedClient();
    const list = await client.favorites.getByGroup(
      "avatar",
      "avatars_1",
      "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(list.length).toBeGreaterThan(0);
    await client.close();
  });
});

describe("avatars 写操作", () => {
  it("selectCurrent 选择当前头像", async () => {
    const client = await authedClient();
    const me = await client.avatars.selectCurrent("avtr_00000000-0000-0000-0000-000000000001");
    expect(me.avatarId).toBe("avtr_00000000-0000-0000-0000-000000000001");
    await client.close();
  });

  it("selectFallback 选择回退头像", async () => {
    const client = await authedClient();
    const me = await client.avatars.selectFallback("avtr_00000000-0000-0000-0000-000000000001");
    expect(me.avatarId).toBe("avtr_00000000-0000-0000-0000-000000000001");
    await client.close();
  });
});

describe("users 写操作", () => {
  it("updateCurrent 更新个人信息", async () => {
    const client = await authedClient();
    const me = await client.users.updateCurrent("usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", {
      status: "busy",
      statusDescription: "busy coding",
    });
    expect(me.status).toBe("busy");
    expect(me.statusDescription).toBe("busy coding");
    await client.close();
  });
});
