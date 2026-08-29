import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 列出 root 下的子目录（相对路径），首项恒为 ""（表示根目录）。
 * 只列目录、跳过以 `.` 开头的隐藏项；depth 从 1 起。
 */
export function listDirs(root: string, maxDepth = 2): string[] {
  const dirs: string[] = [""];
  const walk = (base: string, prefix: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".")) {
        const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
        dirs.push(rel);
        walk(join(base, e.name), rel, depth + 1);
      }
    }
  };
  walk(root, "", 1);
  return dirs;
}
