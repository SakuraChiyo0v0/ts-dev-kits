/**
 * 换行排版纯函数:输入原始文字与排版约束,输出可渲染的文字行。
 * 规则:中文(CJK)按字符断行,连续英文/数字按空白断词;
 * 行数超过 maxLines 时截断,最后一行末尾加省略号「…」。
 * 宽度按近似模型估算:CJK 全角 = fontSize,其余半角 = fontSize × 0.55。
 */

/** 排版约束 */
export interface WrapOptions {
  /** 字号(px),用于宽度估算 */
  fontSize: number;
  /** 最大行宽(px) */
  maxWidth: number;
  /** 最大行数 */
  maxLines: number;
}

/** 排版结果 */
export interface WrapResult {
  /** 排版后的文字行(每行已去首尾空白) */
  lines: string[];
  /** 是否发生截断(行数超出 maxLines) */
  truncated: boolean;
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

/** 字符串近似宽度(px) */
function lineWidth(line: string, fontSize: number): number {
  let width = 0;
  for (const ch of line) {
    width += charWidth(ch, fontSize);
  }
  return width;
}

/**
 * 把一行按宽度切成多行(按字符断行,拉丁词尽量整体换行)。
 * 行首/行尾空白会被丢弃。
 */
function softWrap(line: string, fontSize: number, maxWidth: number): string[] {
  // 拆 token:CJK 单字符一个 token,连续非空白拉丁串一个 token,空白单独一个 token
  const tokens: string[] = [];
  let word = "";
  for (const ch of line) {
    if (isWideCodePoint(ch.codePointAt(0) ?? 0) || /\s/.test(ch)) {
      if (word !== "") {
        tokens.push(word);
        word = "";
      }
      tokens.push(ch);
    } else {
      word += ch;
    }
  }
  if (word !== "") {
    tokens.push(word);
  }

  const out: string[] = [];
  let cur = "";
  for (const token of tokens) {
    // 空白 token:只在行内能放下时保留,行首/行尾自动丢弃
    if (/\s/.test(token)) {
      if (cur !== "" && lineWidth(cur + token, fontSize) <= maxWidth) {
        cur += token;
      }
      continue;
    }
    if (lineWidth(cur + token, fontSize) <= maxWidth) {
      cur += token;
      continue;
    }
    if (cur !== "") {
      out.push(cur.trimEnd());
      cur = "";
    }
    // token 本身超宽(长英文单词/长连续字符):按字符拆
    if (lineWidth(token, fontSize) > maxWidth) {
      let seg = "";
      for (const ch of token) {
        if (lineWidth(seg + ch, fontSize) > maxWidth) {
          out.push(seg);
          seg = ch;
        } else {
          seg += ch;
        }
      }
      cur = seg;
    } else {
      cur = token;
    }
  }
  if (cur.trimEnd() !== "") {
    out.push(cur.trimEnd());
  }
  return out;
}

/** 对排版结果做 maxLines 截断:超出的行丢弃,最后一行末尾补省略号 */
function applyMaxLines(lines: string[], opts: WrapOptions): WrapResult {
  if (opts.maxLines < 1) {
    return { lines: [], truncated: true };
  }
  if (lines.length <= opts.maxLines) {
    return { lines, truncated: false };
  }
  const kept = lines.slice(0, opts.maxLines);
  const ellipsis = "…";
  const ellipsisWidth = charWidth(ellipsis, opts.fontSize);
  let last = kept[opts.maxLines - 1] ?? "";
  // 去掉尾部字符直到放得下省略号
  while (last.length > 0 && lineWidth(last, opts.fontSize) + ellipsisWidth > opts.maxWidth) {
    last = last.slice(0, -1);
  }
  kept[opts.maxLines - 1] = `${last}${ellipsis}`;
  return { lines: kept, truncated: true };
}

/**
 * 换行排版主函数。
 * 支持硬换行:输入中的 \n 会强制分段;随后按宽度软换行并应用 maxLines 截断。
 */
export function wrapText(text: string, opts: WrapOptions): WrapResult {
  const hardLines = text.split(/\r?\n/);
  const softLines: string[] = [];
  for (const hardLine of hardLines) {
    softLines.push(...softWrap(hardLine, opts.fontSize, opts.maxWidth));
  }
  return applyMaxLines(softLines, opts);
}
