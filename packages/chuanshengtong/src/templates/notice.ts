/**
 * 模板:公告。米黄底 + 双线边框 + 红色「公告」标题 + 右下红色印章。
 */
import { FONT_FAMILY } from "../svg.js";
import type { TemplateDefinition, TextRegion } from "../types.js";

const REGION: TextRegion = {
  x: 120,
  y: 420,
  width: 960,
  height: 980,
  align: "center",
  lineHeight: 110,
  defaultFontSize: 58,
  maxLines: 7,
  defaultColor: "#3e2723",
};

export const notice: TemplateDefinition = {
  id: "notice",
  name: "公告",
  description: "复古公告:米黄底双线边框 + 红字标题 + 红色印章",
  width: 1200,
  height: 1600,
  maxTextLength: 110,
  textRegion: REGION,
  buildSvg: (textLayer) => {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">` +
      `<rect width="1200" height="1600" fill="#fdf6e3"/>` +
      `<rect x="30" y="30" width="1140" height="1540" fill="none" stroke="#5d4037" stroke-width="4"/>` +
      `<rect x="46" y="46" width="1108" height="1508" fill="none" stroke="#5d4037" stroke-width="2"/>` +
      `<text x="600" y="240" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="84" font-weight="bold" fill="#c62828">公告</text>` +
      `<rect x="480" y="290" width="240" height="6" fill="#c62828"/>` +
      textLayer +
      `<circle cx="1030" cy="1340" r="110" fill="#c62828" fill-opacity="0.08" stroke="#c62828" stroke-width="6"/>` +
      `<text x="1030" y="1384" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="96" font-weight="bold" fill="#c62828">传</text>` +
      `</svg>`
    );
  },
};
