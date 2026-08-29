import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { DownloadManager } from "../src/index.js";

let cleanup: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "md-test-"));
  cleanup.push(d);
  return d;
}

afterEach(() => {
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
  cleanup = [];
});

/** 起一个本地 HTTP 服务，返回固定内容。 */
async function serve(content: Buffer): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": content.length });
    res.end(content);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { server, url: `http://127.0.0.1:${address.port}/file.bin` };
}

describe("DownloadManager", () => {
  it("listDirs 列出直接子目录", () => {
    const root = tempDir();
    mkdirSync(join(root, "周杰伦"));
    mkdirSync(join(root, "欧美"));
    const m = new DownloadManager({ root });
    expect(m.listDirs()).toEqual(["周杰伦", "欧美"]);
    expect(m.listDirs("周杰伦")).toEqual([]);
  });

  it("createDir 创建子目录", () => {
    const root = tempDir();
    const m = new DownloadManager({ root });
    expect(m.createDir("", "新文件夹")).toBe("新文件夹");
    expect(m.listDirs()).toEqual(["新文件夹"]);
  });

  it("download 下载到根目录并写入历史", async () => {
    const root = tempDir();
    const { server, url } = await serve(Buffer.from("hello media"));
    const m = new DownloadManager({ root });
    const result = await m.download({ url, filename: "test.txt" });
    expect(readFileSync(result.filePath, "utf8")).toBe("hello media");
    expect(m.history()).toHaveLength(1);
    expect(m.history()[0]?.status).toBe("done");
    expect(m.history()[0]?.filename).toBe("test.txt");
    server.close();
  });

  it("download 下载到子目录", async () => {
    const root = tempDir();
    const { server, url } = await serve(Buffer.from("sub"));
    const m = new DownloadManager({ root });
    const result = await m.download({ url, filename: "a.mp3", dir: "music/2026" });
    expect(readFileSync(result.filePath, "utf8")).toBe("sub");
    expect(result.filePath).toContain("music/2026/a.mp3");
    server.close();
  });

  it("history 持久化后重启可恢复", async () => {
    const root = tempDir();
    const { server, url } = await serve(Buffer.from("persist"));
    const m1 = new DownloadManager({ root });
    await m1.download({ url, filename: "p.txt" });
    const m2 = new DownloadManager({ root });
    expect(m2.history()).toHaveLength(1);
    server.close();
  });

  it("clearHistory 清空历史", async () => {
    const root = tempDir();
    const { server, url } = await serve(Buffer.from("x"));
    const m = new DownloadManager({ root });
    await m.download({ url, filename: "c.txt" });
    m.clearHistory();
    expect(m.history()).toHaveLength(0);
    server.close();
  });

  it("非法 target 抛 DownloaderError", async () => {
    const root = tempDir();
    const m = new DownloadManager({ root });
    await expect(m.download({ url: "", filename: "x.txt" })).rejects.toThrow("url and filename are required");
  });

  it("路径穿越被拦截", () => {
    const root = tempDir();
    mkdirSync(join(root, "safe"));
    const m = new DownloadManager({ root });
    // listDirs 对 ../ 免疫（返回空，不报错）。
    expect(m.listDirs("../")).toEqual([]);
    // createDir 拒绝越界。
    expect(() => m.createDir("../..", "evil")).toThrow("path escapes root");
    // download 的 dir 越界会被清洗到根目录内。
    expect(() => m.createDir("a/../../b", "x")).toThrow("path escapes root");
  });
});
