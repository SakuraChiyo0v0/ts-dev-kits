/**
 * Kazumi 流式搜索 SSE 事件解析（纯函数，可单测）。
 *
 * 服务端每个事件格式（routes/kazumi.ts 的 send()）：
 *   event: <type>\ndata: <json>\n\n
 * 支持的事件类型：batch（一批搜索结果）/ done（全部结束）/ error（搜索失败，如验证码拦截）。
 */
export type SearchSseEvent =
  | { type: "batch"; items: Array<{ name: string; src: string; rule: string }> }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "unknown" };

/**
 * 解析单个 SSE 事件文本（不含结尾 \n\n 分隔符）。
 * - 只认 `event: ` 与 `data: ` 行，忽略其余行，避免 event 行残留进 JSON.parse。
 * - data 行为空、JSON 解析失败、事件类型不认识 → 返回对应类型（unknown / error 内容兜底）。
 */
export function parseSseEvent(text: string): SearchSseEvent {
  const lines = text.split("\n");
  const eventLine = lines.find((l) => l.startsWith("event: "));
  const dataLine = lines.find((l) => l.startsWith("data: "));
  const event = eventLine?.slice("event: ".length).trim() ?? "";
  const jsonStr = dataLine?.slice("data: ".length) ?? "";

  if (event === "batch") {
    if (jsonStr === "") return { type: "unknown" };
    try {
      const parsed = JSON.parse(jsonStr) as { items?: Array<{ name: string; src: string; rule: string }> };
      if (Array.isArray(parsed.items)) return { type: "batch", items: parsed.items };
      return { type: "unknown" };
    } catch {
      return { type: "unknown" };
    }
  }

  if (event === "done") return { type: "done" };

  if (event === "error") {
    if (jsonStr === "") return { type: "error", message: "搜索失败（可能被验证码拦截）" };
    try {
      const parsed = JSON.parse(jsonStr) as { message?: string };
      return { type: "error", message: parsed.message ?? "搜索失败（可能被验证码拦截）" };
    } catch {
      return { type: "error", message: "搜索失败（可能被验证码拦截）" };
    }
  }

  return { type: "unknown" };
}

/** 把一个事件文本切分成多个事件（SSE 以空行 \n\n 分隔）。 */
export function splitSseChunks(buffer: string): { parts: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  return { parts: parts.filter((p) => p.trim() !== ""), rest };
}
