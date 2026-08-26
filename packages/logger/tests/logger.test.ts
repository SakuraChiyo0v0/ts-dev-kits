import { describe, it, expect, vi, beforeEach } from "vitest";
import { hostname as osHostname } from "node:os";
import { createLogger, LogLevel } from "../src/index.js";
import type { LogEntry, LogTransport, Logger } from "../src/index.js";

/**
 * 测试用 Transport：收集所有日志条目
 */
class CollectTransport implements LogTransport {
  entries: LogEntry[] = [];

  write(entry: LogEntry): void {
    this.entries.push(entry);
  }

  clear(): void {
    this.entries = [];
  }
}

/**
 * 测试内级别名称映射（仅用于断言，不污染源码）
 */
const LEVEL_NAME: Record<number, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
};

describe("createLogger", () => {
  let transport: CollectTransport;

  beforeEach(() => {
    transport = new CollectTransport();
  });

  it("创建默认 logger（info 级别，无命名空间）", () => {
    const logger = createLogger({ transport });
    expect(logger.namespace).toBe("");
    expect(logger.level).toBe(LogLevel.INFO);
  });

  it("创建带命名空间的 logger", () => {
    const logger = createLogger({ namespace: "bilibili", transport });
    expect(logger.namespace).toBe("bilibili");
  });

  it("创建指定级别的 logger", () => {
    const logger = createLogger({ level: "debug", transport });
    expect(logger.level).toBe(LogLevel.DEBUG);
  });

  it("debug 级别日志被过滤（默认 info）", () => {
    const logger = createLogger({ transport });
    logger.debug("test");
    expect(transport.entries).toHaveLength(0);
  });

  it("info 级别日志正常输出", () => {
    const logger = createLogger({ transport });
    logger.info("hello");
    expect(transport.entries).toHaveLength(1);
    expect(transport.entries[0]!.message).toBe("hello");
    expect(transport.entries[0]!.level).toBe(LogLevel.INFO);
  });

  it("warn 级别日志正常输出", () => {
    const logger = createLogger({ transport });
    logger.warn("warning");
    expect(transport.entries).toHaveLength(1);
    expect(transport.entries[0]!.level).toBe(LogLevel.WARN);
  });

  it("error 级别日志正常输出", () => {
    const logger = createLogger({ transport });
    logger.error("error");
    expect(transport.entries).toHaveLength(1);
    expect(transport.entries[0]!.level).toBe(LogLevel.ERROR);
  });

  it("携带 data 的日志", () => {
    const logger = createLogger({ transport });
    logger.info("download", { videoId: "BV123", quality: 80 });
    expect(transport.entries[0]!.data).toEqual({ videoId: "BV123", quality: 80 });
  });

  it("携带 Error 时写入 entry.error（而非 data）", () => {
    const logger = createLogger({ transport });
    const error = new Error("network error");
    logger.error("failed", error);
    const entry = transport.entries[0]!;
    expect(entry.error).toBe(error);
    expect(entry.data).toBeUndefined();
  });

  it("日志带时间戳", () => {
    const logger = createLogger({ transport });
    logger.info("test");
    expect(transport.entries[0]!.time).toBeInstanceOf(Date);
  });
});

describe("hostname", () => {
  let transport: CollectTransport;

  beforeEach(() => {
    transport = new CollectTransport();
  });

  it("默认自动检测 os.hostname()", () => {
    const logger = createLogger({ transport });
    logger.info("test");
    expect(transport.entries[0]!.hostname).toBe(osHostname());
  });

  it("手动覆盖 hostname", () => {
    const logger = createLogger({ hostname: "desktop-01", transport });
    logger.info("test");
    expect(transport.entries[0]!.hostname).toBe("desktop-01");
  });

  it("子 logger 继承 hostname", () => {
    const parent = createLogger({ hostname: "desktop-01", transport });
    const child = parent.child("download");
    child.info("start");
    expect(transport.entries[0]!.hostname).toBe("desktop-01");
  });
});

describe("child logger - namespace", () => {
  let transport: CollectTransport;

  beforeEach(() => {
    transport = new CollectTransport();
  });

  it("字符串参数创建子命名空间", () => {
    const parent = createLogger({ namespace: "bilibili", transport });
    const child = parent.child("download");
    expect(child.namespace).toBe("bilibili:download");
  });

  it("多级命名空间嵌套", () => {
    const root = createLogger({ namespace: "app", transport });
    const level1 = root.child("bilibili");
    const level2 = level1.child("download");
    expect(level2.namespace).toBe("app:bilibili:download");
  });

  it("子 logger 继承父级别", () => {
    const parent = createLogger({ namespace: "bilibili", level: "debug", transport });
    const child = parent.child("download");
    expect(child.level).toBe(LogLevel.DEBUG);
  });

  it("子 logger 日志带命名空间", () => {
    const parent = createLogger({ namespace: "bilibili", transport });
    const child = parent.child("download");
    child.info("start");
    expect(transport.entries[0]!.namespace).toBe("bilibili:download");
  });
});

describe("child logger - bindings", () => {
  let transport: CollectTransport;

  beforeEach(() => {
    transport = new CollectTransport();
  });

  it("对象参数创建带 bindings 的子 logger", () => {
    const parent = createLogger({ namespace: "bilibili", transport });
    const child = parent.child({ operation: "download" });
    child.info("start");
    expect(transport.entries[0]!.data).toEqual({ operation: "download" });
  });

  it("bindings 自动附加到每条日志", () => {
    const parent = createLogger({ namespace: "bilibili", transport });
    const child = parent.child({ videoId: "BV123" });
    child.info("progress");
    child.warn("slow");
    expect(transport.entries[0]!.data).toEqual({ videoId: "BV123" });
    expect(transport.entries[1]!.data).toEqual({ videoId: "BV123" });
  });

  it("日志数据与 bindings 合并", () => {
    const parent = createLogger({ namespace: "bilibili", transport });
    const child = parent.child({ videoId: "BV123" });
    child.info("progress", { percent: 50 });
    expect(transport.entries[0]!.data).toEqual({ videoId: "BV123", percent: 50 });
  });

  it("日志数据覆盖同名 bindings", () => {
    const parent = createLogger({ namespace: "bilibili", transport });
    const child = parent.child({ videoId: "BV123" });
    child.info("change", { videoId: "BV456" });
    expect(transport.entries[0]!.data).toEqual({ videoId: "BV456" });
  });

  it("多级 bindings 继承", () => {
    const root = createLogger({ namespace: "bilibili", transport });
    const level1 = root.child({ videoId: "BV123" });
    const level2 = level1.child({ percent: 50 });
    level2.info("progress");
    expect(transport.entries[0]!.data).toEqual({ videoId: "BV123", percent: 50 });
  });

  it("child(string) 保留已有 bindings", () => {
    const parent = createLogger({ namespace: "bilibili", transport });
    const bound = parent.child({ videoId: "BV123" });
    const child = bound.child("download");
    child.info("start");
    expect(transport.entries[0]!.data).toEqual({ videoId: "BV123" });
  });
});

describe("custom transport", () => {
  it("使用自定义 transport", () => {
    const logs: string[] = [];
    const customTransport: LogTransport = {
      write(entry) {
        logs.push(`[${LEVEL_NAME[entry.level]}] ${entry.message}`);
      },
    };

    const logger = createLogger({ transport: customTransport });
    logger.info("hello");
    logger.warn("world");
    expect(logs).toEqual(["[INFO] hello", "[WARN] world"]);
  });
});

describe("console transport", () => {
  it("Error 日志输出 message + stack", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const logger = createLogger({ namespace: "bilibili", hostname: "desktop-01" });
      const error = new Error("boom");
      error.stack = "Error: boom\n    at test:1:1";
      logger.error("failed", error);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [line, errorInfo] = errorSpy.mock.calls[0]!;
      expect(line).toContain("[bilibili]@desktop-01");
      expect(line).toContain("ERROR failed");
      expect(errorInfo).toEqual({ message: "boom", stack: "Error: boom\n    at test:1:1" });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("普通日志输出命名空间和 hostname", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const logger = createLogger({ namespace: "bilibili", hostname: "desktop-01" });
      logger.info("hello");

      expect(infoSpy).toHaveBeenCalledTimes(1);
      const [line] = infoSpy.mock.calls[0]!;
      expect(line).toContain("[bilibili]@desktop-01");
      expect(line).toContain("INFO hello");
    } finally {
      infoSpy.mockRestore();
    }
  });
});

describe("log level filtering", () => {
  let transport: CollectTransport;

  beforeEach(() => {
    transport = new CollectTransport();
  });

  it("debug 级别 logger 输出所有日志", () => {
    const logger = createLogger({ level: "debug", transport });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(transport.entries).toHaveLength(4);
  });

  it("warn 级别 logger 只输出 warn 和 error", () => {
    const logger = createLogger({ level: "warn", transport });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(transport.entries).toHaveLength(2);
    expect(transport.entries[0]!.level).toBe(LogLevel.WARN);
    expect(transport.entries[1]!.level).toBe(LogLevel.ERROR);
  });

  it("silent 级别 logger 不输出任何日志", () => {
    const logger = createLogger({ level: "silent", transport });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(transport.entries).toHaveLength(0);
  });
});
