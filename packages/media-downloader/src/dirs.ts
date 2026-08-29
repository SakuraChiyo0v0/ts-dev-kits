import { mkdirSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * 清洗相对子目录：按分隔符切分，丢掉空段、`.` 与 `..`，
 * 只保留合法段并重新拼接。防路径穿越（用户可控的 subdir）。
 */
export function sanitizeSubdir(subdir: string): string {
  return subdir
    .split(/[\\/]/u)
    .filter((seg) => seg !== "" && seg !== "." && seg !== "..")
    .join("/");
}

/** 校验 subdir 落在 root 内（双保险），返回绝对路径；越界抛错。 */
function resolveInside(root: string, subdir: string): string {
  const base = resolve(root, subdir);
  const rootResolved = resolve(root);
  if (base !== rootResolved && !base.startsWith(rootResolved + sep)) {
    throw new Error("path escapes root");
  }
  return base;
}

/**
 * 列出 root 下某目录（subdir，相对 root）的直接子目录名。
 * 只列目录、跳过以 `.` 开头的隐藏项，按名称排序。
 */
export function listDirs(root: string, subdir = ""): string[] {
  const base = resolveInside(root, sanitizeSubdir(subdir));
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
  const safeSub = sanitizeSubdir(subdir);
  const base = resolveInside(root, safeSub);
  mkdirSync(join(base, safeName), { recursive: true });
  return safeSub === "" ? safeName : `${safeSub}/${safeName}`;
}
