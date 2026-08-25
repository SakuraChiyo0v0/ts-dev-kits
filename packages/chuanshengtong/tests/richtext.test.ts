import { describe, expect, it } from "vitest";
import { parseRichText } from "../src/richtext.js";
import { wrapRichText } from "../src/wrap.js";

describe("parseRichText 标记解析", () => {
  it("无标记的纯文本返回单个无样式片段", () => {
    expect(parseRichText("你好,世界")).toEqual([{ text: "你好,世界" }]);
  });

  it("**加粗** 解析为 bold 片段", () => {
    expect(parseRichText("**加粗**")).toEqual([{ text: "加粗", bold: true }]);
  });

  it("*斜体* 解析为 italic 片段", () => {
    expect(parseRichText("*斜体*")).toEqual([{ text: "斜体", italic: true }]);
  });

  it("[c:red]红[/c] 解析为 color 片段", () => {
    expect(parseRichText("[c:red]红[/c]")).toEqual([{ text: "红", color: "red" }]);
    expect(parseRichText("[c:#ff0000]红[/c]")).toEqual([{ text: "红", color: "#ff0000" }]);
  });

  it("混合与叠加样式拆分片段", () => {
    const runs = parseRichText("前**[c:red]粗红[/c]**后");
    expect(runs).toEqual([
      { text: "前" },
      { text: "粗红", bold: true, color: "red" },
      { text: "后" },
    ]);
  });

  it("相邻同样式片段合并", () => {
    // **加** 与 **粗** 相邻(中间无文字)时合并为同一 bold 片段
    expect(parseRichText("**加****粗**")).toEqual([{ text: "加粗", bold: true }]);
  });

  it("未闭合的 ** 按字面输出,不误伤普通文本", () => {
    expect(parseRichText("2**3=8")).toEqual([{ text: "2**3=8" }]);
    expect(parseRichText("普通**")).toEqual([{ text: "普通**" }]);
  });

  it("未闭合的 [c:...] 与裸 [/c] 按字面输出", () => {
    expect(parseRichText("[c:red]未闭合")).toEqual([{ text: "[c:red]未闭合" }]);
    expect(parseRichText("裸[/c]标记")).toEqual([{ text: "裸[/c]标记" }]);
  });

  it("空字符串返回空数组", () => {
    expect(parseRichText("")).toEqual([]);
  });
});

describe("wrapRichText 富文本换行", () => {
  it("样式随字符跨行保留", () => {
    const { lines, truncated } = wrapRichText([{ text: "你好世界", bold: true }], {
      fontSize: 100,
      maxWidth: 300, // 每行 3 个全角字符
      maxLines: 10,
    });
    expect(truncated).toBe(false);
    expect(lines).toEqual([
      [{ text: "你好世", bold: true }],
      [{ text: "界", bold: true }],
    ]);
  });

  it("颜色片段在换行后仍保留", () => {
    const runs = parseRichText("[c:red]红字超长内容[/c]");
    const { lines } = wrapRichText(runs, {
      fontSize: 100,
      maxWidth: 200, // 每行 2 个全角字符
      maxLines: 10,
    });
    expect(lines.every((runs) => runs.every((run) => run.color === "red"))).toBe(true);
  });

  it("截断时省略号继承行尾样式", () => {
    const runs = parseRichText("**很长很长很长很长**");
    const { lines, truncated } = wrapRichText(runs, {
      fontSize: 100,
      maxWidth: 300, // 每行 3 个全角字符 → 8 字排 3 行,超 maxLines 2
      maxLines: 2,
    });
    expect(truncated).toBe(true);
    expect(lines).toHaveLength(2);
    const lastRun = lines[1]![lines[1]!.length - 1]!;
    expect(lastRun.text).toContain("…");
    expect(lastRun.bold).toBe(true);
  });
});
