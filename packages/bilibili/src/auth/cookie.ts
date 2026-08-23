/** 解析 cookie 字符串为对象。 */
export function parseCookieString(cookie: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed === "") {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return result;
}
