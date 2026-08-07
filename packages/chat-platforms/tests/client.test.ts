import { describe, expect, it, vi } from "vitest";
import {
  ChatPlatformClient,
  ChatPlatformError,
  ChatPlatformRegistry,
  defaultRegistry,
  registerPlatform,
  type ChatPlatformAdapter,
} from "../src/index.js";

function fakeAdapter(name: string): ChatPlatformAdapter {
  return {
    name,
    capabilities: { supportsRichText: false, supportsImages: false, splitsLongMessages: false },
    connect: vi.fn(async ({ onMessage }) => {
      // 立即模拟一条入站消息，验证 onMessage 回调链路
      await onMessage({
        messageId: "m-1",
        source: { platform: name, chatId: "chat-1", type: "private", userId: "u-1" },
        text: "hello",
      });
    }),
    disconnect: vi.fn(async () => undefined),
    send: vi.fn(async (source, message) => ({
      platform: name,
      messageId: "sent-1",
      ok: true,
    })),
  };
}

describe("ChatPlatformRegistry", () => {
  it("registers and creates adapters", () => {
    const registry = new ChatPlatformRegistry();
    registry.register({
      id: "fake",
      label: "Fake",
      create: () => fakeAdapter("fake"),
    });
    const adapter = registry.create("fake", {});
    expect(adapter.name).toBe("fake");
    expect(registry.list().map((e) => e.id)).toEqual(["fake"]);
  });

  it("rejects duplicate registration", () => {
    const registry = new ChatPlatformRegistry();
    registry.register({ id: "fake", label: "Fake", create: () => fakeAdapter("fake") });
    expect(() =>
      registry.register({ id: "fake", label: "Fake2", create: () => fakeAdapter("fake2") }),
    ).toThrow(ChatPlatformError);
  });

  it("throws on unknown platform", () => {
    const registry = new ChatPlatformRegistry();
    expect(() => registry.create("nope", {})).toThrow(/unknown chat platform/);
  });

  it("global registerPlatform writes to defaultRegistry", () => {
    registerPlatform({ id: "fake-global", label: "Fake", create: () => fakeAdapter("fake") });
    expect(defaultRegistry.list().map((e) => e.id)).toContain("fake-global");
  });
});

describe("ChatPlatformClient", () => {
  it("adds adapters, routes onMessage, sends and disconnects", async () => {
    const client = new ChatPlatformClient();
    const adapter = fakeAdapter("fake");
    const handler = vi.fn();
    client.onMessage(handler);

    await client.add(adapter);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "m-1", text: "hello" }),
    );
    expect(adapter.connect).toHaveBeenCalledOnce();

    const result = await client.send(
      { platform: "fake", chatId: "chat-1", type: "private" },
      { text: "hi" },
    );
    expect(result.ok).toBe(true);
    expect(adapter.send).toHaveBeenCalledWith(
      { platform: "fake", chatId: "chat-1", type: "private" },
      { text: "hi" },
    );

    await client.disconnectAll();
    expect(adapter.disconnect).toHaveBeenCalledOnce();
  });

  it("throws when sending to unknown platform", async () => {
    const client = new ChatPlatformClient();
    await expect(
      client.send({ platform: "missing", chatId: "c", type: "private" }, { text: "x" }),
    ).rejects.toThrow(/no adapter for platform/);
  });
});
