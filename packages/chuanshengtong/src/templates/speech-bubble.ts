/**
 * 模板:台词气泡。漫画风白色椭圆气泡 + 黑描边 + 尾巴,文字居中。
 */
import { buildTextLayer, FONT_FAMILY } from "../svg.js";
import type { TemplateDefinition, TextRegion } from "../types.js";

const REGION: TextRegion = {
  x: 170,
  y: 190,
  width: 860,
  height: 470,
  align: "center",
  lineHeight: 88,
  defaultFontSize: 56,
  maxLines: 5,
  defaultColor: "#222222",
};

export const speechBubble: TemplateDefinition = {
  id: "speech-bubble",
  name: "台词气泡",
  description: "漫画风台词气泡:白底黑描边椭圆 + 尾巴,适合角色台词",
  width: 1200,
  height: 900,
  maxTextLength: 60,
  textRegion: REGION,
  buildSvg: (lines, { fontSize, color }) => {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">` +
      `<rect width="1200" height="900" fill="#e8f4fd"/>` +
      `<polygon points="812,690 972,786 902,688" fill="#ffffff" stroke="#2b2b2b" stroke-width="6" stroke-linejoin="round"/>` +
      `<ellipse cx="600" cy="415" rx="500" ry="305" fill="#ffffff" stroke="#2b2b2b" stroke-width="8"/>` +
      buildTextLayer({ lines, region: REGION, fontSize, color }) +
      `</svg>`
    );
  },
};
