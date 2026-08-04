import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockApi {
  url: string;
  server: Server;
  /** 记录请求路径(含 query),便于断言签名参数。 */
  requests: Array<{ path: string; headers: Record<string, string | undefined> }>;
  close(): Promise<void>;
}

/** 模拟 B 站 API 服务器。handler 返回 JSON body(code=0 表示成功)。 */
export async function startMockApi(
  routes: Record<string, () => unknown>,
): Promise<MockApi> {
  const requests: Array<{ path: string; headers: Record<string, string | undefined> }> = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    requests.push({
      path,
      headers: Object.fromEntries(
        Object.entries(request.headers).map(([key, value]) => [key, String(value)]),
      ),
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
