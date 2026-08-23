import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockRequest {
  path: string;
  headers: Record<string, string | undefined>;
  method: string;
  /** POST 表单/JSON body(已解析);GET 为 undefined。 */
  body?: Record<string, unknown>;
}

export interface MockApi {
  url: string;
  server: Server;
  /** 记录请求路径(含 query)与 POST body,便于断言签名/表单参数。 */
  requests: MockRequest[];
  close(): Promise<void>;
}

/** 模拟 B 站 API 服务器。handler 返回 JSON body(code=0 表示成功)。 */
export async function startMockApi(
  routes: Record<string, () => unknown>,
): Promise<MockApi> {
  const requests: MockRequest[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    let rawBody = "";
    request.on("data", (chunk: Buffer) => {
      rawBody += chunk.toString("utf-8");
    });
    request.on("end", () => {
      requests.push({
        path,
        method: request.method ?? "GET",
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [key, String(value)]),
        ),
        ...(rawBody !== "" ? { body: parseBody(rawBody) } : {}),
      });
      const url = new URL(path, "http://127.0.0.1");
      const pathname = url.pathname;
      const handler = routes[pathname];
      if (handler === undefined) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: -404, message: "not found" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: 0, data: handler() }));
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

/** 解析 application/x-www-form-urlencoded 或 JSON body(表单值保持字符串,与线上行为一致)。 */
function parseBody(raw: string): Record<string, unknown> {
  if (raw.startsWith("{")) {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // fall through to form parsing
    }
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(raw)) {
    result[key] = value;
  }
  return result;
}
