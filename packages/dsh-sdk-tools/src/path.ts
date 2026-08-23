/** 展开用户主目录 `~` 前缀;非 `~` 开头原样返回。 */
export function expandHome(path: string): string {
  if (path === "~") return homeDir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return `${homeDir()}${path.slice(1)}`;
  }
  return path;
}

function homeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
}
