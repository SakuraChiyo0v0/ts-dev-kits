/**
 * 轻量富文本:行内标记解析。
 *
 * 语法(可叠加):
 *   **文字**          加粗
 *   *文字*            斜体
 *   [c:red]文字[/c]   指定颜色(CSS 颜色名或 #hex)
 * 示例:**[c:red]粗红[/c]**
 *
 * 规则:标记必须成对才生效,未闭合的标记(如正文里的 `2**3=8`)按字面输出,
 * 避免误伤普通文本。解析结果合并相邻同样式片段。
 */
import type { RichRun } from "./types.js";

/** [c:值] 开标记;值 = CSS 颜色名 / #hex / rgb() */
const COLOR_OPEN = /^\[c:([^\]]+)\]/;

/** 解析行内标记为富文本片段流 */
export function parseRichText(text: string): RichRun[] {
  const runs: RichRun[] = [];
  let bold = false;
  let italic = false;
  let color: string | null = null;
  let buf = "";

  /** 把累积的普通文本按当前样式落成 run */
  const flush = () => {
    if (buf === "") {
      return;
    }
    runs.push({
      text: buf,
      ...(bold ? { bold: true } : {}),
      ...(italic ? { italic: true } : {}),
      ...(color !== null ? { color } : {}),
    });
    buf = "";
  };

  let i = 0;
  while (i < text.length) {
    // 加粗:已开启则关闭;未开启需找到配对才开启,否则按字面输出
    if (text.startsWith("**", i)) {
      if (bold) {
        flush();
        bold = false;
      } else if (text.indexOf("**", i + 2) !== -1) {
        flush();
        bold = true;
      } else {
        buf += "**";
      }
      i += 2;
      continue;
    }
    // 斜体:已开启则关闭;未开启需找到配对才开启,否则按字面输出
    if (text[i] === "*") {
      if (italic) {
        flush();
        italic = false;
      } else if (text.indexOf("*", i + 1) !== -1) {
        flush();
        italic = true;
      } else {
        buf += "*";
      }
      i += 1;
      continue;
    }
    // [c:值] 开颜色;需存在配对的 [/c] 才生效,否则按字面输出
    const colorMatch = COLOR_OPEN.exec(text.slice(i));
    if (colorMatch !== null) {
      if (text.indexOf("[/c]", i + colorMatch[0].length) !== -1) {
        flush();
        color = colorMatch[1]!;
      } else {
        buf += colorMatch[0];
      }
      i += colorMatch[0].length;
      continue;
    }
    // [/c] 关颜色;未开启时按字面输出
    if (text.startsWith("[/c]", i)) {
      if (color !== null) {
        flush();
        color = null;
      } else {
        buf += "[/c]";
      }
      i += 4;
      continue;
    }
    buf += text[i]!;
    i += 1;
  }
  flush();

  // 合并相邻同样式片段,减少 tspan 数量
  const merged: RichRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (
      last !== undefined &&
      last.bold === run.bold &&
      last.italic === run.italic &&
      last.color === run.color
    ) {
      last.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}
