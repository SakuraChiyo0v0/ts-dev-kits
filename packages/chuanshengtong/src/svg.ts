/**
 * SVG 辅助:XML 转义 + 文本层生成。
 * 模板负责背景与装饰,文本层统一由此函数生成,保证排版一致。
 */
import type { TextRegion } from "./types.js";

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
  lines: string[];
  region: TextRegion;
  fontSize: number;
  color: string;
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
    .map((line, index) => {
      const y = startY + index * region.lineHeight;
      return (
        `<text x="${x}" y="${y.toFixed(1)}" text-anchor="${anchor}" ` +
        `font-family="${FONT_FAMILY}" font-size="${fontSize}" fill="${color}">` +
        `${escapeXml(line)}</text>`
      );
    })
    .join("\n");
}
