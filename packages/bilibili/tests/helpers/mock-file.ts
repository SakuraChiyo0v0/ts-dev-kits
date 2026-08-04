import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockFileServer {
  url: string;
  server: Server;
  close(): Promise<void>;
}

/** 模拟 CDN 文件服务器,支持 HEAD 和 Range 请求。 */
export async function startMockFileServer(content?: Buffer): Promise<MockFileServer> {
  const body = content ?? Buffer.from("0123456789abcdef".repeat(1024)); // 16KB
  const server = createServer((request, response) => {
    if (request.method === "HEAD") {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(body.length),
      });
      response.end();
      return;
    }
    // GET 支持 Range。
    const range = request.headers.range;
    if (range !== undefined) {
      const match = /bytes=(\d+)-(\d*)/u.exec(range);
      if (match) {
        const start = Number(match[1]);
        const end = match[2] === "" ? body.length - 1 : Number(match[2]);
        const chunk = body.subarray(start, end + 1);
        response.writeHead(206, {
          "content-type": "application/octet-stream",
          "content-range": `bytes ${start}-${end}/${body.length}`,
          "content-length": String(chunk.length),
        });
        response.end(chunk);
        return;
      }
    }
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(body.length),
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/video.m4s`,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
