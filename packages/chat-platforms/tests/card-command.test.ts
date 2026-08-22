import { describe, expect, it } from "vitest";
import {
  actionCard,
  cardCommandValue,
  parseCardCommandValue,
} from "../src/card-command.js";

describe("cardCommandValue", () => {
  it("encodes command + chat_type + user_id", () => {
    const v = cardCommandValue("/approve abc123", {
      chatType: "group",
      userId: "ou_123",
    });
    expect(v).toEqual({
      command: "/approve abc123",
      chat_type: "group",
      user_id: "ou_123",
    });
  });

  it("omits empty user_id", () => {
    const v = cardCommandValue("/deny x", { chatType: "private" });
    expect(v).toEqual({ command: "/deny x", chat_type: "private" });
  });

  it("omits undefined chatType", () => {
    const v = cardCommandValue("/hello");
    expect(v).toEqual({ command: "/hello" });
  });
});

describe("parseCardCommandValue", () => {
  it("decodes object value", () => {
    const v = parseCardCommandValue({
      command: "/approve abc123",
      chat_type: "group",
      user_id: "ou_123",
    });
    expect(v).toEqual({
      command: "/approve abc123",
      chat_type: "group",
      user_id: "ou_123",
    });
  });

  it("decodes plain string (legacy)", () => {
    expect(parseCardCommandValue("/answer q1 2")).toEqual({ command: "/answer q1 2" });
  });

  it("trims command whitespace", () => {
    expect(parseCardCommandValue({ command: "  /hi  " })).toEqual({ command: "/hi" });
  });

  it("returns null for empty/invalid", () => {
    expect(parseCardCommandValue(undefined)).toBeNull();
    expect(parseCardCommandValue("")).toBeNull();
    expect(parseCardCommandValue({ noCommand: true })).toBeNull();
    expect(parseCardCommandValue({ command: "   " })).toBeNull();
  });

  it("ignores unknown chat_type", () => {
    const v = parseCardCommandValue({ command: "/x", chat_type: "guild" });
    expect(v).toEqual({ command: "/x" });
  });
});

describe("actionCard", () => {
  it("builds card with command buttons encoding context", () => {
    const card = actionCard({
      header: "需要批准操作",
      markdown: "**工具**: bash",
      chatType: "group",
      userId: "ou_123",
      buttons: [
        { text: "允许一次", type: "primary", command: "/approve abc123" },
        { text: "拒绝", type: "danger", command: "/deny abc123" },
      ],
    });
    expect(card.header).toBe("需要批准操作");
    expect(card.markdown).toBe("**工具**: bash");
    expect(card.elements).toHaveLength(2);
    const btn0 = card.elements[0];
    expect(btn0).toBeDefined();
    if (btn0?.tag === "button") {
      expect(btn0.text).toBe("允许一次");
      expect(btn0.type).toBe("primary");
      expect(btn0.value).toEqual({
        command: "/approve abc123",
        chat_type: "group",
        user_id: "ou_123",
      });
    }
  });

  it("builds card with explicit value buttons", () => {
    const card = actionCard({
      buttons: [{ text: "自定义", value: { action: "custom", id: 7 } }],
    });
    const btn = card.elements[0];
    if (btn?.tag === "button") {
      expect(btn.value).toEqual({ action: "custom", id: 7 });
    }
  });

  it("returns empty elements when no buttons", () => {
    const card = actionCard({ header: "标题", markdown: "正文" });
    expect(card.elements).toEqual([]);
  });
});
