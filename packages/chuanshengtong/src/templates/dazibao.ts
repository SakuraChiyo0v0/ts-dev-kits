/**
 * 模板:大字报。红头白字标题 + 中部黑色大字正文 + 底部红条。
 */
import { FONT_FAMILY } from "../svg.js";
import type { TemplateDefinition, TextRegion } from "../types.js";

const REGION: TextRegion = {
  x: 120,
  y: 280,
  width: 960,
  height: 1080,
  align: "center",
  lineHeight: 110,
  defaultFontSize: 64,
  maxLines: 8,
  defaultColor: "#1a1a1a",
};

export const dazibao: TemplateDefinition = {
  id: "dazibao",
  name: "大字报",
  description: "红头大字报:顶部红底白字标题 + 中部黑色大字正文 + 底部红条",
  width: 1200,
  height: 1600,
  maxTextLength: 120,
  textRegion: REGION,
  buildSvg: (textLayer) => {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">` +
      `<rect width="1200" height="1600" fill="#fbf7ef"/>` +
      `<rect x="0" y="0" width="1200" height="200" fill="#c62828"/>` +
      `<text x="600" y="132" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="72" font-weight="bold" fill="#ffffff">传声筒</text>` +
      `<rect x="0" y="1460" width="1200" height="140" fill="#c62828"/>` +
      `<text x="600" y="1552" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="36" fill="#ffffff">— 传声筒 · 文字留声 —</text>` +
      textLayer +
      `</svg>`
    );
  },
};
