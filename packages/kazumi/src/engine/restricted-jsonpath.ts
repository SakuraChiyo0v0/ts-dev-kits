/**
 * 受限 JSONPath 沙箱。
 *
 * 只支持 Kazumi 规则所需的安全子集:
 * - `$`               根
 * - `.key`            属性访问
 * - `['key']` / `["key"]` 属性访问(引号键)
 * - `[n]`             数组索引
 * - `[*]`             数组通配(展开全部元素)
 *
 * 显式拒绝:函数调用(如 `length()`)、过滤表达式(如 `[?()]`)、递归下降(如 `..`)、
 * 通配属性(如 `.*`)、union/切片(如 `[1,2]` / `[1:3]`)。规则只能读取,不能执行任意代码。
 */
export class RestrictedJsonPath {
  private constructor() {}

  /** 校验表达式合法性,非法抛 KazumiError(RULE_INVALID)。 */
  static validate(expression: string): void {
    if (expression.trim() === "") {
      throw new Error("JSONPath 不能为空");
    }
    if (!expression.startsWith("$")) {
      throw new Error(`JSONPath 必须以 \$ 开头: ${expression}`);
    }
    let i = 1;
    while (i < expression.length) {
      const char = expression[i]!;
      if (char === ".") {
        // .key
        i++;
        const start = i;
        while (i < expression.length && /[A-Za-z0-9_$-]/.test(expression[i]!)) {
          i++;
        }
        if (i === start) {
          throw new Error(`不支持的 JSONPath 片段: ${expression.slice(start - 1)}`);
        }
        continue;
      }
      if (char === "[") {
        const end = findBracketEnd(expression, i);
        const content = expression.slice(i + 1, end).trim();
        const isIndex = /^\d+$/.test(content);
        const isWildcard = content === "*";
        const isQuoted =
          content.length >= 2 &&
          ((content.startsWith("'") && content.endsWith("'")) ||
            (content.startsWith('"') && content.endsWith('"')));
        if (!isIndex && !isWildcard && !isQuoted) {
          throw new Error(`不支持的 JSONPath 片段: [${content}]`);
        }
        i = end + 1;
        continue;
      }
      if (char === ".") {
        throw new Error(`不支持的 JSONPath: ${expression}`);
      }
      throw new Error(`不支持的 JSONPath 字符 '${char}': ${expression}`);
    }
  }

  /** 求值表达式,返回匹配值数组(无匹配返回空数组)。 */
  static read(document: unknown, expression: string): unknown[] {
    RestrictedJsonPath.validate(expression);
    const results: unknown[] = [];
    // 从 '$' 之后的第一个片段开始求值
    walk(document, expression, 1, results);
    return results;
  }

  /** 求值并返回第一个匹配值,无匹配返回 undefined。 */
  static readFirst(document: unknown, expression: string): unknown {
    return RestrictedJsonPath.read(document, expression)[0];
  }
}

/** 找到与 start 处 '[' 配对的 ']' 位置(支持引号内 ']')。 */
function findBracketEnd(expression: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < expression.length; i++) {
    const char = expression[i]!;
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "]") return i;
  }
  throw new Error(`JSONPath 缺少 ]: ${expression}`);
}

/**
 * 按表达式前缀逐段求值。
 * pos 指向当前待处理的片段起点(初始为 1,即 '$' 之后)。
 */
function walk(
  node: unknown,
  expression: string,
  pos: number,
  results: unknown[],
): void {
  if (node === undefined) {
    // 键不存在/索引越界:不产生匹配
    return;
  }
  if (pos >= expression.length) {
    results.push(node);
    return;
  }
  const char = expression[pos]!;
  if (char === ".") {
    // .key
    const key = readKey(expression, pos + 1);
    if (typeof node !== "object" || node === null) return;
    const value = (node as Record<string, unknown>)[key];
    walk(value, expression, pos + 1 + key.length, results);
    return;
  }
  if (char === "[") {
    const end = findBracketEnd(expression, pos);
    const content = expression.slice(pos + 1, end).trim();
    if (content === "*") {
      if (!Array.isArray(node)) return;
      for (const item of node) {
        walk(item, expression, end + 1, results);
      }
      return;
    }
    if (/^\d+$/.test(content)) {
      if (!Array.isArray(node)) return;
      const index = Number(content);
      walk(node[index], expression, end + 1, results);
      return;
    }
    // 引号键
    const key = content.slice(1, -1);
    if (typeof node !== "object" || node === null) return;
    walk((node as Record<string, unknown>)[key], expression, end + 1, results);
    return;
  }
  throw new Error(`不支持的 JSONPath: ${expression}`);
}

/** 读取 .key 的键名(到非 [A-Za-z0-9_$-] 字符为止)。 */
function readKey(expression: string, start: number): string {
  let i = start;
  while (i < expression.length && /[A-Za-z0-9_$-]/.test(expression[i]!)) {
    i++;
  }
  return expression.slice(start, i);
}
