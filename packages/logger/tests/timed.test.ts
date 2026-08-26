import { describe, it, expect, beforeEach } from "vitest";
import { createLogger, timed, LogLevel } from "../src/index.js";
import type { LogEntry, LogTransport, Logger } from "../src/index.js";

/**
 * 测试用 Transport：收集所有日志条目。
 */
class CollectTransport implements LogTransport {
  entries: LogEntry[] = [];

  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

/** 等待一小段时间,保证 durationMs > 0。 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("@timed 装饰器", () => {
  let transport: CollectTransport;
  let logger: Logger;

  beforeEach(() => {
    transport = new CollectTransport();
    // debug 级别,让 start/done 都能被记录(默认 info 会过滤 debug 的开始日志)
    logger = createLogger({ level: "debug", transport });
  });

  it("同步方法记录 start + done,含 durationMs", () => {
    class Service {
      readonly logger = logger;
      @timed()
      run(): number {
        return 42;
      }
    }
    const service = new Service();
    const result = service.run();

    expect(result).toBe(42);
    expect(transport.entries.map((e) => e.level)).toEqual([
      LogLevel.DEBUG,
      LogLevel.INFO,
    ]);
    expect(transport.entries[0]!.message).toBe("timed start");
    expect(transport.entries[0]!.data).toEqual({ name: "Service.run" });
    expect(transport.entries[1]!.message).toBe("timed done");
    expect(transport.entries[1]!.data).toMatchObject({ name: "Service.run" });
    expect(typeof (transport.entries[1]!.data! as { durationMs: number }).durationMs).toBe("number");
  });

  it("异步方法在 resolve 后记录 done", async () => {
    class Service {
      readonly logger = logger;
      @timed()
      async run(): Promise<string> {
        await sleep(5);
        return "ok";
      }
    }
    const service = new Service();
    const result = await service.run();

    expect(result).toBe("ok");
    const done = transport.entries.at(-1)!;
    expect(done.message).toBe("timed done");
    expect((done.data! as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(5);
  });

  it("方法抛错时记录 timed failed(含 durationMs)并原样重新抛出", async () => {
    class Service {
      readonly logger = logger;
      @timed()
      async fail(): Promise<void> {
        await sleep(2);
        throw new Error("boom");
      }
    }
    const service = new Service();

    await expect(service.fail()).rejects.toThrow("boom");
    const failed = transport.entries.at(-1)!;
    expect(failed.level).toBe(LogLevel.ERROR);
    expect(failed.message).toBe("timed failed");
    expect(failed.data).toMatchObject({ name: "Service.fail" });
    // 错误对象放在 data.error(装饰器把 error 作为结构化字段传入)
    expect((failed.data! as { error: unknown }).error).toBeInstanceOf(Error);
    expect((failed.data! as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(2);
  });

  it("options.name 覆盖记录名", () => {
    class Service {
      readonly logger = logger;
      @timed({ name: "custom-op" })
      run(): void {}
    }
    const service = new Service();
    service.run();

    expect(transport.entries[0]!.data).toMatchObject({ name: "custom-op" });
    expect(transport.entries[1]!.data).toMatchObject({ name: "custom-op" });
  });

  it("options.level 改变成功日志级别", () => {
    class Service {
      readonly logger = logger;
      @timed({ level: "debug" })
      run(): void {}
    }
    const service = new Service();
    service.run();

    expect(transport.entries[1]!.level).toBe(LogLevel.DEBUG);
  });

  it("options.logStart: false 关闭开始日志", () => {
    class Service {
      readonly logger = logger;
      @timed({ logStart: false })
      run(): void {}
    }
    const service = new Service();
    service.run();

    expect(transport.entries).toHaveLength(1);
    expect(transport.entries[0]!.message).toBe("timed done");
  });

  it("显式传 logger 优先于 this.logger", () => {
    const other = createLogger({ level: "debug", namespace: "other", transport });
    class Service {
      readonly logger = logger;
      @timed({ logger: other })
      run(): void {}
    }
    const service = new Service();
    service.run();

    expect(transport.entries[0]!.namespace).toBe("other");
  });

  it("实例无 logger 时用默认 logger(不抛错)", () => {
    class Service {
      @timed()
      run(): void {}
    }
    const service = new Service();
    expect(() => service.run()).not.toThrow();
  });
});
