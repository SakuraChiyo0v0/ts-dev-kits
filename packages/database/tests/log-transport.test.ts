import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createLogger, LogLevel } from "@sakurachiyo0v0/logger";
import { DatabaseLogTransport, queryLogs, defaultLocalLogPath } from "../src/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("DatabaseLogTransport + queryLogs (本地 SQLite)", () => {
  let tmpDir: string;
  let localPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "log-test-"));
    localPath = join(tmpDir, "test.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("写入日志到本地 SQLite 并可按条件查询", async () => {
    const transport = new DatabaseLogTransport({ localPath });
    const logger = createLogger({ namespace: "bilibili", hostname: "desktop-01", transport });

    logger.info("download started", { videoId: "BV1xx" });
    logger.error("download failed", new Error("boom"));
    logger.warn("retrying", { attempt: 2 });
    logger.debug("hidden debug"); // 默认 info 级别,不落库

    // 等本地异步写完成
    await new Promise((r) => setTimeout(r, 100));
    await transport.close();

    // 全部(默认 info 以上)
    const all = await queryLogs({ localPath });
    expect(all.length).toBe(3);

    // 按等级过滤
    const errors = await queryLogs({ localPath, level: "error" });
    expect(errors.length).toBe(1);
    expect(errors[0]!.message).toBe("download failed");
    expect(errors[0]!.data).toContain("boom");

    // 按设备过滤
    const dev = await queryLogs({ localPath, hostname: "desktop-01" });
    expect(dev.length).toBe(3);

    // 按命名空间
    const ns = await queryLogs({ localPath, namespace: "bilibili" });
    expect(ns.length).toBe(3);

    // 按关键词
    const kw = await queryLogs({ localPath, keyword: "download" });
    expect(kw.length).toBe(2);

    // 按时间区间
    const from = await queryLogs({
      localPath,
      from: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(from.length).toBe(3);
  });

  it("按等级 + 设备 + 命名空间组合过滤", async () => {
    const transport = new DatabaseLogTransport({ localPath });
    const a = createLogger({ namespace: "account", hostname: "desktop-01", transport });
    const b = createLogger({ namespace: "bilibili", hostname: "desktop-02", transport });

    a.info("login ok");
    b.warn("cdn fallback");
    b.error("download failed");

    await new Promise((r) => setTimeout(r, 100));
    await transport.close();

    const r = await queryLogs({
      localPath,
      level: ["warn", "error"],
      hostname: "desktop-02",
    });
    expect(r.length).toBe(2);

    const r2 = await queryLogs({ localPath, namespace: "account" });
    expect(r2.length).toBe(1);
    expect(r2[0]!.hostname).toBe("desktop-01");
  });

  it("分页 limit/offset", async () => {
    const transport = new DatabaseLogTransport({ localPath });
    const logger = createLogger({ namespace: "paging", transport });
    for (let i = 0; i < 5; i++) {
      logger.info(`msg-${i}`);
    }
    await new Promise((r) => setTimeout(r, 100));
    await transport.close();

    const page1 = await queryLogs({ localPath, limit: 2 });
    expect(page1.length).toBe(2);
    const page2 = await queryLogs({ localPath, limit: 2, offset: 2 });
    expect(page2.length).toBe(2);
    // 倒序:最新在前
    expect(page1[0]!.message).toBe("msg-4");
    expect(page2[0]!.message).toBe("msg-2");
  });

  it("无日志时返回空数组", async () => {
    const transport = new DatabaseLogTransport({ localPath });
    await transport.close();
    const r = await queryLogs({ localPath });
    expect(r).toEqual([]);
  });

  it("日志级别字段以字符串存库", async () => {
    const transport = new DatabaseLogTransport({ localPath });
    const logger = createLogger({ namespace: "levels", transport });
    logger.warn("w");
    await new Promise((r) => setTimeout(r, 100));
    await transport.close();

    const r = await queryLogs({ localPath });
    expect(r[0]!.level).toBe("WARN");
  });
});
