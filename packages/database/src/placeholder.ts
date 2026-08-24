import type { DataDialect } from "./types.js";

/**
 * 把上层统一写法的 SQL 转换为目标方言的最终 SQL,处理占位符与转义。
 *
 * 统一规则(单引号字符串内一律原样保留,`''` 为转义引号):
 * - postgres:`??` → 字面 `?`(API 转义,解决 JSONB 单 `?` 操作符 `data ? 'key'` 与占位符同形的问题)
 * - `?`   → 占位符:sqlite/mysql 原生保留 `?`;postgres 按出现顺序转 `$1`/`$2`/...
 * - postgres 下 `?|` / `?&`(JSONB 多字符操作符)原样保留,不当作占位符
 *
 * 注:`??` 转义仅对 postgres 生效——sqlite/mysql 的驱动会把字符串外的 `?` 一律当作
 * 占位符,且这两种方言的 SQL 中不存在字符串外的字面 `?` 用法,无需转义。
 */
export function convertPlaceholders(sql: string, dialect: DataDialect): string {
  let out = "";
  let placeholderIndex = 0;
  let inString = false;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i]!;

    if (inString) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          // 转义引号 `''` 成对消费,仍在字符串内
          out += "'";
          i += 2;
          continue;
        }
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === "'") {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "?") {
      const next = sql[i + 1];
      if (next === "?") {
        // API 转义(postgres):`??` 表示字面 `?`;sqlite/mysql 无此需求,原样保留
        if (dialect === "postgres") {
          out += "?";
          i += 2;
          continue;
        }
        out += ch;
        i += 1;
        continue;
      }
      if (dialect === "postgres" && (next === "|" || next === "&")) {
        // PG JSONB 多字符操作符 `?|` / `?&`,原样保留
        out += ch;
        i += 1;
        continue;
      }
      if (dialect === "postgres") {
        placeholderIndex += 1;
        out += `$${placeholderIndex}`;
        i += 1;
        continue;
      }
      // sqlite / mysql 原生支持 `?` 占位符,直传
      out += ch;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}
