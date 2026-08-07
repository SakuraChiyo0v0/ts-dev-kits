/**
 * SKILL.md 解析器 —— 参考 hermes tools/skill_manager_tool.py 的 frontmatter 设计。
 * SKILL.md 格式：
 *   ---
 *   name: skill-name
 *   description: 一句话描述（触发词开头）
 *   category: 可选分类
 *   ---
 *   <body: 给 LLM 的指令>
 */
import { promises as fs } from "node:fs";
import path from "node:path";

/** 解析后的技能元数据 */
export interface SkillMeta {
  /** 技能名（工具名） */
  name: string;
  /** 描述（LLM 路由信号） */
  description: string;
  /** 可选分类 */
  category?: string;
  /** 原始 frontmatter 其余字段 */
  extra: Record<string, unknown>;
  /** SKILL.md 正文（指令） */
  body: string;
}

export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;

/** 校验 SKILL.md 内容，返回错误信息（null 表示合法）。参考 hermes _validate_frontmatter。 */
export function validateSkillContent(content: string): string | null {
  if (!content.trim()) return "SKILL.md 内容不能为空";
  // 容忍 BOM（Windows 编辑器）
  const text = content.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    return "SKILL.md 必须以 YAML frontmatter（---）开头";
  }
  const endMatch = /\n---\s*\n/.exec(text.slice(3));
  if (!endMatch) return "SKILL.md frontmatter 未闭合（缺少结束的 --- 行）";

  const yamlContent = text.slice(3, endMatch.index + 3);
  const fm = parseFrontmatter(yamlContent);
  if (fm === null) return "SKILL.md frontmatter 解析失败";

  if (typeof fm.name !== "string" || !fm.name.trim()) {
    return "frontmatter 必须包含 name 字段";
  }
  const name = fm.name.trim();
  if (name.length > MAX_NAME_LENGTH) return `name 超过 ${MAX_NAME_LENGTH} 字符`;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return "name 只能包含字母、数字、下划线、连字符";
  }

  if (typeof fm.description !== "string" || !fm.description.trim()) {
    return "frontmatter 必须包含 description 字段";
  }
  const desc = fm.description.trim();
  if (desc.length > MAX_DESCRIPTION_LENGTH) {
    return `description 超过 ${MAX_DESCRIPTION_LENGTH} 字符`;
  }

  const body = text.slice(endMatch.index + endMatch[0].length + 3).trim();
  if (!body) return "SKILL.md 在 frontmatter 之后必须有正文（指令内容）";

  return null;
}

/** 解析 SKILL.md 内容为 SkillMeta（不校验，调用前先 validate）。 */
export function parseSkillContent(content: string): SkillMeta {
  const text = content.replace(/^\uFEFF/, "");
  const endMatch = /\n---\s*\n/.exec(text.slice(3));
  const yamlContent = endMatch ? text.slice(3, endMatch.index + 3) : text.slice(3);
  const fm = parseFrontmatter(yamlContent) ?? {};
  const body = endMatch ? text.slice(endMatch.index + endMatch[0].length + 3).trim() : "";

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (k !== "name" && k !== "description" && k !== "category") {
      extra[k] = v;
    }
  }

  return {
    name: typeof fm.name === "string" ? fm.name.trim() : "",
    description: typeof fm.description === "string" ? fm.description.trim() : "",
    ...(typeof fm.category === "string" && fm.category ? { category: fm.category.trim() } : {}),
    extra,
    body,
  };
}

/**
 * 极简 YAML frontmatter 解析（只支持 key: value 平铺，不做嵌套）。
 * 参考 hermes 的 _parse_frontmatter_quick。失败返回 null。
 */
export function parseFrontmatter(raw: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    // 去掉引号
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value === "" || value === "null" || value === "~") {
      result[key] = null;
      continue;
    }
    if (value === "true") { result[key] = true; continue; }
    if (value === "false") { result[key] = false; continue; }
    // 数字
    const num = Number(value);
    if (value !== "" && Number.isFinite(num) && /^-?\d+(\.\d+)?$/.test(value)) {
      result[key] = num;
      continue;
    }
    result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** 递归列出目录下的所有 SKILL.md 文件 */
export async function findSkillFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findSkillFiles(full)));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      out.push(full);
    }
  }
  return out;
}
