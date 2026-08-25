/**
 * 换行排版纯函数:输入原始文字/富文本片段与排版约束,输出可渲染的文字行。
 * 规则:中文(CJK)按字符断行,连续英文/数字按空白断词;
 * 行数超过 maxLines 时截断,最后一行末尾加省略号「…」。
 * 宽度按近似模型估算:CJK 全角 = fontSize,其余半角 = fontSize × 0.55。
 * 富文本样式(加粗/斜体/颜色)在换行时随字符保留,不影响宽度估算。
 */
import type { RichRun } from "./types.js";

/** 排版约束 */
export interface WrapOptions {
  /** 字号(px),用于宽度估算 */
  fontSize: number;
  /** 最大行宽(px) */
  maxWidth: number;
  /** 最大行数 */
  maxLines: number;
}

/** 排版结果(纯文本行) */
export interface WrapResult {
  /** 排版后的文字行(每行已去首尾空白) */
  lines: string[];
  /** 是否发生截断(行数超出 maxLines) */
  truncated: boolean;
}

/** 排版结果(富文本行:每行是片段流) */
export interface RichTextWrapResult {
  lines: RichRun[][];
  truncated: boolean;
}

/** 带样式的字符(内部结构) */
interface StyledChar {
  ch: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

/** 判断一个码点是否按全角(宽度 = fontSize)处理 */
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK Radicals / 部首 / CJK 标点(、。「」等)
    (cp >= 0x3041 && cp <= 0x33ff) || // 平假名 / 片假名 / CJK 兼容(全角符号)
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 扩展 A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 统一表意文字
    (cp >= 0xa000 && cp <= 0xa4cf) || // 彝文
    (cp >= 0xac00 && cp <= 0xd7a3) || // 谚文音节
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容表意文字
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK 兼容形式(全角括号等)
    (cp >= 0xff00 && cp <= 0xff60) || // 全角形式(全角 ASCII 标点)
    (cp >= 0xffe0 && cp <= 0xffe6) || // 全角符号(¥、￠等)
    (cp >= 0x1f300 && cp <= 0x1faff) || // Emoji(按全宽近似)
    (cp >= 0x20000 && cp <= 0x2fa1f) // CJK 扩展 B+
  );
}

/** 单字符近似宽度(px) */
export function charWidth(ch: string, fontSize: number): number {
  const cp = ch.codePointAt(0);
  if (cp === undefined) {
    return 0;
  }
  return isWideCodePoint(cp) ? fontSize : fontSize * 0.55;
}

/** 字符序列近似宽度(px) */
function lineWidth(chars: StyledChar[], fontSize: number): number {
  let width = 0;
  for (const c of chars) {
    width += charWidth(c.ch, fontSize);
  }
  return width;
}

/** 富文本片段流展开为带样式的字符序列 */
function expandRuns(runs: RichRun[]): StyledChar[] {
  const chars: StyledChar[] = [];
  for (const run of runs) {
    for (const ch of run.text) {
      chars.push({
        ch,
        ...(run.bold ? { bold: true } : {}),
        ...(run.italic ? { italic: true } : {}),
        ...(run.color !== undefined ? { color: run.color } : {}),
      });
    }
  }
  return chars;
}

/** 字符序列重新合并为富文本片段流(相邻同样式合并) */
function toRuns(chars: StyledChar[]): RichRun[] {
  const runs: RichRun[] = [];
  for (const c of chars) {
    const last = runs[runs.length - 1];
    if (
      last !== undefined &&
      last.bold === c.bold &&
      last.italic === c.italic &&
      last.color === c.color
    ) {
      last.text += c.ch;
    } else {
      runs.push({
        text: c.ch,
        ...(c.bold ? { bold: true } : {}),
        ...(c.italic ? { italic: true } : {}),
        ...(c.color !== undefined ? { color: c.color } : {}),
      });
    }
  }
  return runs;
}

/** 拆 token:CJK 单字符一个 token,连续非空白拉丁串一个 token,空白单独一个 token */
function tokenizeStyled(chars: StyledChar[]): StyledChar[][] {
  const tokens: StyledChar[][] = [];
  let word: StyledChar[] = [];
  for (const c of chars) {
    const cp = c.ch.codePointAt(0) ?? 0;
    if (isWideCodePoint(cp) || /\s/.test(c.ch)) {
      if (word.length > 0) {
        tokens.push(word);
        word = [];
      }
      tokens.push([c]);
    } else {
      word.push(c);
    }
  }
  if (word.length > 0) {
    tokens.push(word);
  }
  return tokens;
}

/**
 * 把一行(带样式字符)按宽度切成多行。行首/行尾空白会被丢弃。
 */
function softWrapStyled(chars: StyledChar[], fontSize: number, maxWidth: number): StyledChar[][] {
  const tokens = tokenizeStyled(chars);
  const out: StyledChar[][] = [];
  let cur: StyledChar[] = [];

  const isBlank = (c: StyledChar): boolean => /\s/.test(c.ch);

  for (const token of tokens) {
    // 空白 token:只在行内能放下时保留
    if (isBlank(token[0]!)) {
      if (cur.length > 0 && lineWidth([...cur, ...token], fontSize) <= maxWidth) {
        cur.push(...token);
      }
      continue;
    }
    if (lineWidth([...cur, ...token], fontSize) <= maxWidth) {
      cur.push(...token);
      continue;
    }
    if (cur.length > 0) {
      // 去掉行尾空白
      while (cur.length > 0 && isBlank(cur[cur.length - 1]!)) {
        cur.pop();
      }
      out.push(cur);
      cur = [];
    }
    // token 本身超宽(长英文单词/长连续字符):按字符拆
    if (lineWidth(token, fontSize) > maxWidth) {
      let seg: StyledChar[] = [];
      for (const c of token) {
        if (lineWidth([...seg, c], fontSize) > maxWidth) {
          out.push(seg);
          seg = [c];
        } else {
          seg.push(c);
        }
      }
      cur = seg;
    } else {
      cur = token;
    }
  }
  if (cur.length > 0) {
    while (cur.length > 0 && isBlank(cur[cur.length - 1]!)) {
      cur.pop();
    }
    if (cur.length > 0) {
      out.push(cur);
    }
  }
  return out;
}

/** 对排版结果做 maxLines 截断:超出的行丢弃,最后一行末尾补省略号(继承行尾样式) */
function applyMaxLinesStyled(
  lines: StyledChar[][],
  opts: WrapOptions,
): { lines: StyledChar[][]; truncated: boolean } {
  if (opts.maxLines < 1) {
    return { lines: [], truncated: true };
  }
  if (lines.length <= opts.maxLines) {
    return { lines, truncated: false };
  }
  const kept = lines.slice(0, opts.maxLines);
  const ellipsis = "…";
  const ellipsisWidth = charWidth(ellipsis, opts.fontSize);
  let last = [...(kept[opts.maxLines - 1] ?? [])];
  // 去掉尾部字符直到放得下省略号
  while (last.length > 0 && lineWidth(last, opts.fontSize) + ellipsisWidth > opts.maxWidth) {
    last.pop();
  }
  const tailStyle = last[last.length - 1];
  kept[opts.maxLines - 1] = [
    ...last,
    {
      ch: ellipsis,
      ...(tailStyle?.bold ? { bold: true } : {}),
      ...(tailStyle?.italic ? { italic: true } : {}),
      ...(tailStyle?.color !== undefined ? { color: tailStyle.color } : {}),
    },
  ];
  return { lines: kept, truncated: true };
}

/**
 * 富文本换行排版主函数。
 * 支持硬换行:片段文本中的 \n 会强制分段;随后按宽度软换行并应用 maxLines 截断。
 */
export function wrapRichText(runs: RichRun[], opts: WrapOptions): RichTextWrapResult {
  const chars = expandRuns(runs);
  // 硬换行分段
  const segments: StyledChar[][] = [];
  let cur: StyledChar[] = [];
  for (const c of chars) {
    if (c.ch === "\n") {
      segments.push(cur);
      cur = [];
    } else {
      cur.push(c);
    }
  }
  segments.push(cur);

  const softLines: StyledChar[][] = [];
  for (const segment of segments) {
    softLines.push(...softWrapStyled(segment, opts.fontSize, opts.maxWidth));
  }
  const { lines, truncated } = applyMaxLinesStyled(softLines, opts);
  return { lines: lines.map(toRuns), truncated };
}

/**
 * 纯文本换行排版主函数(wrapRichText 的便捷形态,行为与旧版一致)。
 */
export function wrapText(text: string, opts: WrapOptions): WrapResult {
  const { lines, truncated } = wrapRichText([{ text }], opts);
  return {
    lines: lines.map((runs) => runs.map((run) => run.text).join("")),
    truncated,
  };
}
