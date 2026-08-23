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

describe("groups", () => {
  it("getById / search / create / update / delete", async () => {
    const client = await authedClient();
    const group = await client.groups.getById("grp_00000000-0000-0000-0000-000000000000");
    expect(group.name).toBe("Mock Group");

    const list = await client.groups.search({ search: "mock" });
    expect(list.length).toBeGreaterThan(0);

    const created = await client.groups.create({ name: "New Group" });
    expect(created.id).toBeDefined();

    const updated = await client.groups.update("grp_00000000-0000-0000-0000-000000000000", {
      description: "updated",
    });
    expect(updated.description).toBe("updated");

    const removed = await client.groups.delete("grp_00000000-0000-0000-0000-000000000000");
    expect(removed.success.message).toContain("deleted");
    await client.close();
  });

  it("listMembers / listRoles / createRole / deleteRole", async () => {
    const client = await authedClient();
    const members = await client.groups.listMembers("grp_00000000-0000-0000-0000-000000000000");
    expect(members.length).toBeGreaterThan(0);

    const roles = await client.groups.listRoles("grp_00000000-0000-0000-0000-000000000000");
    expect(roles.length).toBeGreaterThan(0);

    const templates = await client.groups.listRoleTemplates();
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0]!.name).toBe("Member");

    const role = await client.groups.createRole("grp_00000000-0000-0000-0000-000000000000", {
      name: "Moderator",
    });
    expect(role.name).toBe("Member"); // mock 返回默认角色

    const removed = await client.groups.deleteRole(
      "grp_00000000-0000-0000-0000-000000000000",
      "grp_00000000-0000-0000-0000-000000000000_member",
    );
    expect(removed.success.message).toContain("deleted");
    await client.close();
  });

  it("成员管理:getMember / removeMember / 角色分配", async () => {
    const client = await authedClient();
    const gid = "grp_00000000-0000-0000-0000-000000000000";
    const uid = "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";

    const member = await client.groups.getMember(gid, uid);
    expect(member.username).toBe("bob");

    const withRole = await client.groups.addRoleToMember(gid, uid, "grole_owner");
    expect(withRole.roleIds).toContain("grole_owner");

    const withoutRole = await client.groups.removeRoleFromMember(gid, uid, "grole_owner");
    expect(withoutRole).toBeDefined();

    const removed = await client.groups.removeMember(gid, uid);
    expect(removed.success.message).toContain("removed");
    await client.close();
  });

  it("申请与封禁:listRequests / approveRequest / listBans / banMember / unbanMember", async () => {
    const client = await authedClient();
    const gid = "grp_00000000-0000-0000-0000-000000000000";
    const uid = "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";

    const requests = await client.groups.listRequests(gid);
    expect(requests.length).toBeGreaterThan(0);

    const approved = await client.groups.approveRequest(gid, uid);
    expect(approved).toBeDefined();

    const bans = await client.groups.listBans(gid);
    expect(bans.length).toBeGreaterThan(0);
    expect(bans[0]!.user.username).toBe("bob");

    const banned = await client.groups.banMember(gid, uid);
    expect(banned).toBeDefined();

    const unbanned = await client.groups.unbanMember(gid, uid);
    expect(unbanned.success.message).toContain("unbanned");
    await client.close();
  });

  it("listInstances / listPermissions", async () => {
    const client = await authedClient();
    const gid = "grp_00000000-0000-0000-0000-000000000000";
    const instances = await client.groups.listInstances(gid);
    expect(instances.length).toBeGreaterThan(0);
    const perms = await client.groups.listPermissions(gid);
    expect(perms).toContain("group-members");
    await client.close();
  });

  it("join / leave / announcement", async () => {
    const client = await authedClient();
    await client.groups.join("grp_00000000-0000-0000-0000-000000000000");
    const left = await client.groups.leave("grp_00000000-0000-0000-0000-000000000000");
    expect(left.success.message).toContain("Left");

    const ann = await client.groups.getAnnouncement("grp_00000000-0000-0000-0000-000000000000");
    expect(ann.message).toBe("Hello");
    const updated = await client.groups.setAnnouncement("grp_00000000-0000-0000-0000-000000000000", "New");
    expect(updated.message).toBe("New");
    await client.close();
  });
});

describe("files", () => {
  it("getById / list / create / delete", async () => {
    const client = await authedClient();
    const file = await client.files.getById("file_00000000-0000-0000-0000-000000000000");
    expect(file.name).toBe("mock.png");

    const list = await client.files.list();
    expect(list.length).toBeGreaterThan(0);

    const created = await client.files.create({
      name: "new.png",
      mimeType: "image/png",
      extension: ".png",
    });
    expect(created.name).toBe("new.png");

    const image = await client.files.createImage({
      name: "icon.png",
      mimeType: "image/png",
      extension: ".png",
    });
    expect(image.name).toBe("icon.png");

    const removed = await client.files.delete("file_00000000-0000-0000-0000-000000000000");
    expect(removed.success.message).toContain("deleted");
    await client.close();
  });

  it("startUpload / finishUpload / getUploadStatus 上传链路", async () => {
    const client = await authedClient();
    const start = await client.files.startUpload("file_00000000-0000-0000-0000-000000000000", 1);
    expect(start.url).toContain("upload-target");

    const finish = await client.files.finishUpload("file_00000000-0000-0000-0000-000000000000", 1, "file", ["mock-etag"]);
    expect(finish.etags).toContain("mock-etag");

    const status = await client.files.getUploadStatus("file_00000000-0000-0000-0000-000000000000", 1);
    expect(status.status).toBe("complete");
    await client.close();
  });
});

describe("worlds 管理", () => {
  it("publish / update / delete", async () => {
    const client = await authedClient();
    const published = await client.worlds.publish("wrld_00000000-0000-0000-0000-000000000000");
    expect(published.id).toBeDefined();

    const updated = await client.worlds.update("wrld_00000000-0000-0000-0000-000000000000", {
      description: "new desc",
    });
    expect(updated.description).toBe("new desc");

    const removed = await client.worlds.delete("wrld_00000000-0000-0000-0000-000000000000");
    expect(removed.success.message).toContain("deleted");
    await client.close();
  });

  it("addTags / removeTags", async () => {
    const client = await authedClient();
    const wid = "wrld_00000000-0000-0000-0000-000000000000";
    const added = await client.worlds.addTags(wid, ["my_tag"]);
    expect(added.id).toBeDefined();
    const removed = await client.worlds.removeTags(wid, ["my_tag"]);
    expect(removed.id).toBeDefined();
    await client.close();
  });
});

describe("permissions", () => {
  it("list / getById", async () => {
    const client = await authedClient();
    const list = await client.permissions.list();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.name).toBe("avatar-access");

    const perm = await client.permissions.getById("permission_00000000-0000-0000-0000-000000000000");
    expect(perm.name).toBe("avatar-access");
    await client.close();
  });
});
