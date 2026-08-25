import { describe, expect, it } from "vitest";
import { buildTextLayer, escapeXml } from "../src/svg.js";
import type { TextRegion } from "../src/types.js";

describe("escapeXml 转义", () => {
  it("转义 XML 特殊字符,防止文字注入 SVG 结构", () => {
    expect(escapeXml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
  });

  it("普通文本原样保留", () => {
    expect(escapeXml("你好,世界")).toBe("你好,世界");
  });
});

describe("buildTextLayer 文本层生成", () => {
  const region: TextRegion = {
    x: 100,
    y: 200,
    width: 800,
    height: 400,
    align: "center",
    lineHeight: 100,
    defaultFontSize: 60,
    maxLines: 4,
    defaultColor: "#111111",
  };

  it("空行返回空字符串", () => {
    expect(buildTextLayer({ lines: [], region, fontSize: 60, color: "#000" })).toBe("");
  });

  it("居中:每个 text 元素 text-anchor=middle,x 在文本区中心", () => {
    const svg = buildTextLayer({ lines: ["第一行", "第二行"], region, fontSize: 60, color: "#c62828" });
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('x="500"'); // 100 + 800/2
    expect(svg).toContain('font-size="60"');
    expect(svg).toContain('fill="#c62828"');
    expect(svg).toContain("第一行");
    expect(svg).toContain("第二行");
  });

  it("行间 y 按 lineHeight 递增", () => {
    const svg = buildTextLayer({ lines: ["a", "b", "c"], region, fontSize: 60, color: "#000" });
    const ys = [...svg.matchAll(/y="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(3);
    expect(ys[1]! - ys[0]!).toBeCloseTo(region.lineHeight);
    expect(ys[2]! - ys[1]!).toBeCloseTo(region.lineHeight);
  });

  it("左对齐:text-anchor=start,x 在文本区左缘", () => {
    const leftRegion: TextRegion = { ...region, align: "left" };
    const svg = buildTextLayer({ lines: ["a"], region: leftRegion, fontSize: 60, color: "#000" });
    expect(svg).toContain('text-anchor="start"');
    expect(svg).toContain('x="100"');
  });
});
