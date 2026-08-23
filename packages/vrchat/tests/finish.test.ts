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

describe("system", () => {
  it("stats / time 无需登录也可用", async () => {
    const client = await createVrchatClient({ baseUrl: server!.baseUrl });
    const stats = await client.system.stats();
    expect(typeof stats).toBe("number");
    const time = await client.system.time();
    expect(typeof time).toBe("string");
    await client.close();
  });

  it("health 需登录,未登录抛 AUTH_EXPIRED", async () => {
    const client = await createVrchatClient({ baseUrl: server!.baseUrl });
    await expect(client.system.health()).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
    await client.close();
  });

  it("health 登录后可用", async () => {
    const client = await authedClient();
    const health = await client.system.health();
    expect(health.ok).toBe(true);
    await client.close();
  });
});

describe("messages 快捷消息", () => {
  it("list / get / update", async () => {
    const client = await authedClient();
    const list = await client.messages.list("usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "message");
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.message).toBe("Hello!");

    const one = await client.messages.get("usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "message", 1);
    expect(one.slug).toBe("message_1");

    const updated = await client.messages.update("usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "message", 1, "Hi there!");
    expect(updated.message).toBe("Hi there!");
    await client.close();
  });
});

describe("economy", () => {
  it("getBalance / getTransactions", async () => {
    const client = await authedClient();
    const balance = await client.economy.getBalance("usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(balance.balance).toBe(42);
    const txs = await client.economy.getTransactions("usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(txs.length).toBeGreaterThan(0);
    expect(txs[0]!.status).toBe("succeeded");
    await client.close();
  });
});

describe("moderation", () => {
  it("list / create / delete", async () => {
    const client = await authedClient();
    const list = await client.moderation.list({ type: "block" });
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.type).toBe("block");

    const created = await client.moderation.create({
      type: "mute",
      moderated: "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    expect(created.type).toBe("mute");
    expect(created.targetUserId).toBe("usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee");

    const removed = await client.moderation.unmoderate({
      type: "mute",
      moderated: "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    expect(removed.type).toBe("mute");
    await client.close();
  });

  it("report 举报用户", async () => {
    const client = await authedClient();
    const result = await client.moderation.report({
      reporterUserId: "usr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      reportedUserId: "usr_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
      type: "None",
    });
    expect(result.success.message).toContain("Report");
    await client.close();
  });
});
