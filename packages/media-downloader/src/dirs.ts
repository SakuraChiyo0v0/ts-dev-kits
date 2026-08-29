import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 列出 root 下某目录（subdir，相对 root）的直接子目录名。
 * 只列目录、跳过以 `.` 开头的隐藏项，按名称排序。
 */
export function listDirs(root: string, subdir = ""): string[] {
  const base = subdir === "" ? root : join(root, subdir);
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

/** 在 root/subdir 下创建子目录，返回其相对 root 的路径。 */
export function createDir(root: string, subdir: string, name: string): string {
  const safeName = name.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "_").trim();
  if (safeName === "") {
    throw new Error("folder name must not be empty");
  }
  const base = subdir === "" ? root : join(root, subdir);
  mkdirSync(join(base, safeName), { recursive: true });
  return subdir === "" ? safeName : `${subdir}/${safeName}`;
}
