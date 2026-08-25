/**
 * 模板:卡片。深色渐变底 + 白色文字居中 + 圆角,顶部与底部小字装饰。
 */
import { buildTextLayer, FONT_FAMILY } from "../svg.js";
import type { TemplateDefinition, TextRegion } from "../types.js";

const REGION: TextRegion = {
  x: 90,
  y: 320,
  width: 720,
  height: 560,
  align: "center",
  lineHeight: 96,
  defaultFontSize: 60,
  maxLines: 6,
  defaultColor: "#ffffff",
};

export const card: TemplateDefinition = {
  id: "card",
  name: "卡片",
  description: "深色渐变卡片:白色文字居中,适合一句话表达",
  width: 900,
  height: 1200,
  maxTextLength: 90,
  textRegion: REGION,
  buildSvg: (lines, { fontSize, color }) => {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">` +
      `<defs>` +
      `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="#1a1a2e"/>` +
      `<stop offset="100%" stop-color="#16213e"/>` +
      `</linearGradient>` +
      `</defs>` +
      `<rect width="900" height="1200" fill="url(#bg)"/>` +
      `<rect x="24" y="24" width="852" height="1152" rx="36" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="2"/>` +
      `<text x="450" y="180" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="34" letter-spacing="12" fill="#ffffff" fill-opacity="0.75">CHUANSHENGTONG</text>` +
      buildTextLayer({ lines, region: REGION, fontSize, color }) +
      `<text x="450" y="1100" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="28" fill="#ffffff" fill-opacity="0.6">· 传声筒 ·</text>` +
      `</svg>`
    );
  },
};
