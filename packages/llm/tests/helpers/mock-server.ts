import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** 可配置响应的本地 mock 服务器,模拟各家 LLM API。 */
export interface MockServer {
  url: string;
  server: Server;
  requests: Array<{ path: string; headers: Record<string, string | undefined>; body: unknown }>;
  close(): Promise<void>;
}

export async function startMockServer(
  handler: (path: string, body: unknown, headers: Record<string, string | undefined>) => {
    status: number;
    body: string;
    contentType?: string;
  },
): Promise<MockServer> {
  const requests: Array<{ path: string; headers: Record<string, string | undefined>; body: unknown }> = [];

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      let body: unknown = null;
      if (text !== "") {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = text;
        }
      }
      const headers = Object.fromEntries(
        Object.entries(request.headers).map(([key, value]) => [key, String(value)]),
      ) as Record<string, string | undefined>;
      requests.push({ path: request.url ?? "/", headers, body });

      const result = handler(request.url ?? "/", body, headers);
      response.writeHead(result.status, {
        "content-type": result.contentType ?? "application/json",
      });
      response.end(result.body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
