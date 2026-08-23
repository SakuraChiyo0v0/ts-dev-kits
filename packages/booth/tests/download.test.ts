import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BoothSession } from "../src/session.js";
import {
  DownloadApi,
  sanitizeFilename,
  fileNameFromUrl,
  fileNameFromDisposition,
} from "../src/api/download.js";
import { BoothError } from "../src/errors.js";
import { createMockBoothServer, type MockBoothServer } from "./helpers/mock-server.js";

let server: MockBoothServer | null = null;

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }
});

async function withServer(fn: (srv: MockBoothServer) => Promise<void>): Promise<void> {
  const srv = await createMockBoothServer();
  server = srv;
  try {
    await fn(srv);
  } finally {
    await srv.close();
    server = null;
  }
}

function downloadApi(srv: MockBoothServer): DownloadApi {
  const session = new BoothSession({ baseUrl: srv.url, cookie: "_pixiv_session=test" });
  return new DownloadApi(session);
}

describe("sanitizeFilename", () => {
  it("清理不安全字符", () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(sanitizeFilename("..hidden")).toBe("_hidden");
  });
});

describe("fileNameFromUrl", () => {
  it("从 URL pathname 提取文件名", () => {
    expect(fileNameFromUrl("https://s3.example/x/y/asset.zip")).toBe("asset.zip");
    expect(fileNameFromUrl("https://s3.example/readme.txt?X-Amz-Signature=1")).toBe("readme.txt");
  });

  it("URL 编码文件名解码", () => {
    expect(fileNameFromUrl("https://s3.example/a%20b%20c.zip")).toBe("a b c.zip");
  });

  it("无效 URL 回退随机名", () => {
    expect(fileNameFromUrl("::bad::")).toMatch(/^download_/);
  });
});

describe("fileNameFromDisposition", () => {
  it("解析普通 filename", () => {
    expect(fileNameFromDisposition('attachment; filename="x.zip"')).toBe("x.zip");
  });

  it("解析 UTF-8 filename*", () => {
    expect(fileNameFromDisposition("attachment; filename*=UTF-8''%E3%83%86%E3%82%B9%E3%83%88.zip")).toBe(
      "テスト.zip",
    );
  });

  it("无头返回 undefined", () => {
    expect(fileNameFromDisposition(null)).toBeUndefined();
  });
});

describe("DownloadApi.downloadUrl", () => {
  it("下载到本地", async () => {
    await withServer(async (srv) => {
      const dir = mkdtempSync(path.join(tmpdir(), "booth-dl-"));
      try {
        srv.setFileContent("hello.txt", "hello");
        const api = downloadApi(srv);
        const outPath = await api.downloadUrl(`${srv.url}/files/hello.txt`, { outputDir: dir });
        expect(existsSync(outPath)).toBe(true);
        expect(readFileSync(outPath, "utf-8")).toBe("hello");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("幂等跳过已存在文件", async () => {
    await withServer(async (srv) => {
      const dir = mkdtempSync(path.join(tmpdir(), "booth-dl-"));
      try {
        srv.setFileContent("hello.txt", "hello");
        const api = downloadApi(srv);
        const first = await api.downloadUrl(`${srv.url}/files/hello.txt`, { outputDir: dir });
        // 修改服务端内容,第二次调用应跳过(保留原文件)。
        srv.setFileContent("hello.txt", "world!");
        const second = await api.downloadUrl(`${srv.url}/files/hello.txt`, { outputDir: dir });
        expect(first).toBe(second);
        expect(readFileSync(second, "utf-8")).toBe("hello");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("重试后仍失败 → DOWNLOAD_FAILED", async () => {
    await withServer(async (srv) => {
      const dir = mkdtempSync(path.join(tmpdir(), "booth-dl-"));
      try {
        // 不注册文件内容 → 下载 404。
        const api = downloadApi(srv);
        try {
          await api.downloadUrl(`${srv.url}/files/missing.bin`, { outputDir: dir, retries: 1 });
          throw new Error("should have thrown");
        } catch (error) {
          expect((error as BoothError).code).toBe("DOWNLOAD_FAILED");
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("Content-Disposition 文件名优先", async () => {
    await withServer(async (srv) => {
      const dir = mkdtempSync(path.join(tmpdir(), "booth-dl-"));
      try {
        srv.setFileContent("server-name.bin", "data");
        const api = downloadApi(srv);
        const outPath = await api.downloadUrl(`${srv.url}/files/server-name.bin`, { outputDir: dir });
        expect(readFileSync(outPath, "utf-8")).toBe("data");
        expect(statSync(outPath).size).toBe(4);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
