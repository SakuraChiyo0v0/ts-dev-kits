/**
 * account-panel 应用日志：基于 @sakurachiyo0v0/logger，自定义 FileTransport 落盘。
 * 日志写到 DOWNLOAD_DIR/logs/app.log（NAS 挂载目录，重启不丢）。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger, LogLevel, type LogEntry, type LogTransport } from "@sakurachiyo0v0/logger";

/** 文件 transport：把每条日志以 JSON 行追加到文件。 */
export function createFileTransport(filePath: string): LogTransport {
  return {
    write(entry: LogEntry) {
      try {
        const line = JSON.stringify({
          t: entry.time.toISOString(),
          lv: LogLevel[entry.level] ?? String(entry.level),
          ns: entry.namespace,
          msg: entry.message,
          ...(entry.data !== undefined ? { data: entry.data } : {}),
        });
        appendFileSync(filePath, line + "\n");
      } catch {
        // 忽略写入失败（磁盘满等不阻塞主流程）。
      }
    },
  };
}

const logDir = join(process.env.DOWNLOAD_DIR ?? "/downloads", "logs");
try {
  mkdirSync(logDir, { recursive: true });
} catch {
  // 忽略。
}

export const logFilePath = join(logDir, "app.log");

export const appLogger = createLogger({
  namespace: "account-panel",
  transport: createFileTransport(logFilePath),
});
