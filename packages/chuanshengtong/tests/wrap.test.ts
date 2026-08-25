import { describe, expect, it } from "vitest";
import { charWidth, wrapText } from "../src/wrap.js";

describe("charWidth 宽度估算", () => {
  it("CJK 全角按字号计宽", () => {
    expect(charWidth("中", 100)).toBe(100);
  });

  it("ASCII 半角按 0.55 倍字号计宽", () => {
    expect(charWidth("a", 100)).toBeCloseTo(55);
  });

  it("全角标点按全宽计宽", () => {
    expect(charWidth("。", 100)).toBe(100);
    expect(charWidth("「", 100)).toBe(100);
  });
});

describe("wrapText 中文按字符断行", () => {
  it("每行按宽度容纳整数字符", () => {
    // 字号 100 → 每字符 100px;maxWidth 300 → 每行 3 字
    const result = wrapText("你好世界啊", { fontSize: 100, maxWidth: 300, maxLines: 10 });
    expect(result.truncated).toBe(false);
    expect(result.lines).toEqual(["你好世", "界啊"]);
  });
});

describe("wrapText 英文按词断行", () => {
  it("整词换行,行内空格保留", () => {
    // "hello world" = 605px ≤ 700;再加 "foo"(165) 超 700 → 断到第二行
    const result = wrapText("hello world foo", { fontSize: 100, maxWidth: 700, maxLines: 10 });
    expect(result.lines).toEqual(["hello world", "foo"]);
  });

  it("超宽单词按字符拆", () => {
    // 单个单词宽 550 > maxWidth 300 → 拆成两半
    const result = wrapText("aaaaaaaaaa", { fontSize: 100, maxWidth: 300, maxLines: 10 });
    expect(result.lines).toEqual(["aaaaa", "aaaaa"]);
    // 每行 5 个半角字符 × 55 = 275 ≤ 300
    expect(result.lines.every((line) => line.length === 5)).toBe(true);
  });
});

describe("wrapText 硬换行与混合", () => {
  it("\\n 强制分段", () => {
    const result = wrapText("第一行\n第二行", { fontSize: 100, maxWidth: 1000, maxLines: 10 });
    expect(result.lines).toEqual(["第一行", "第二行"]);
  });

  it("中文与英文混合", () => {
    const result = wrapText("今天学 TypeScript", { fontSize: 100, maxWidth: 400, maxLines: 10 });
    // 今天学 = 300,+" " = 355,+"TypeScript" 超 → 断行
    expect(result.lines[0]).toBe("今天学");
    expect(result.lines.join("")).toBe("今天学TypeScript");
  });

  it("空字符串返回空行且不截断", () => {
    const result = wrapText("", { fontSize: 100, maxWidth: 300, maxLines: 10 });
    expect(result.lines).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe("wrapText 超长截断", () => {
  it("超过 maxLines 截断并补省略号", () => {
    const result = wrapText("你好世界你好世界你好世界", {
      fontSize: 100,
      maxWidth: 300,
      maxLines: 2,
    });
    expect(result.truncated).toBe(true);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1]).toContain("…");
  });

  it("maxLines 小于 1 视为全截断", () => {
    const result = wrapText("你好", { fontSize: 100, maxWidth: 300, maxLines: 0 });
    expect(result.lines).toEqual([]);
    expect(result.truncated).toBe(true);
  });
});
