/**
 * SVG 辅助:XML 转义 + 文本层生成。
 * 模板负责背景与装饰,文本层统一由此函数生成,保证排版一致。
 * 富文本:每行一个 <text>,行内片段用 <tspan> 表达加粗/斜体/颜色,
 * tspan 不设坐标时按文本流连续排列,行宽与居中由渲染引擎精确计算。
 */
import type { RichRun, TextRegion } from "./types.js";

/** 跨平台中文字体栈(sharp 经 libvips/Pango 渲染,取系统已装字体) */
export const FONT_FAMILY =
  "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC','WenQuanYi Micro Hei','Noto Sans SC',sans-serif";

/** XML 文本转义,防止用户文字注入 SVG 结构 */
export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** 文本层生成参数 */
export interface TextLayerOptions {
  /** 排版好的文字行(每行是富文本片段流) */
  lines: RichRun[][];
  region: TextRegion;
  fontSize: number;
  /** 全局默认文字颜色(片段未指定 color 时生效) */
  color: string;
}

/** 单个片段的 tspan 属性串(不含文本) */
function tspanAttrs(run: RichRun): string {
  const attrs: string[] = [];
  if (run.bold) {
    attrs.push('font-weight="bold"');
  }
  if (run.italic) {
    attrs.push('font-style="italic"');
  }
  if (run.color !== undefined) {
    attrs.push(`fill="${escapeXml(run.color)}"`);
  }
  return attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
}

/**
 * 在文本区内垂直居中生成多行 <text> 元素。
 * 每行基线按 region.lineHeight 递增,水平对齐取 region.align。
 */
export function buildTextLayer({ lines, region, fontSize, color }: TextLayerOptions): string {
  if (lines.length === 0) {
    return "";
  }
  const totalHeight = lines.length * region.lineHeight;
  // 首行基线:文本区垂直居中 + 一行高度(基线大约在行内 0.8 处,取 fontSize 近似)
  const startY = region.y + Math.max(0, (region.height - totalHeight) / 2) + fontSize;
  const anchor = region.align === "center" ? "middle" : "start";
  const x = region.align === "center" ? region.x + region.width / 2 : region.x;

  return lines
    .map((runs, index) => {
      const y = startY + index * region.lineHeight;
      const tspans = runs
        .map((run) => `<tspan${tspanAttrs(run)}>${escapeXml(run.text)}</tspan>`)
        .join("");
      return (
        `<text x="${x}" y="${y.toFixed(1)}" text-anchor="${anchor}" ` +
        `font-family="${FONT_FAMILY}" font-size="${fontSize}" fill="${color}">` +
        `${tspans}</text>`
      );
    })
    .join("\n");
}
