/**
 * 网易云 mock API 服务器(测试用)。
 * 网易云成功响应格式为 { code: 200, ... };本服务器按路径分发,记录请求便于断言。
 * 额外支持二进制媒体路由(路径以 /media/ 开头),用于下载链路测试。
 */
import { createServer, type Server } from "node:http";
import { createCipheriv, createHash } from "node:crypto";
import type { AddressInfo } from "node:net";

const EAPI_KEY = "e82ckenh8dichen8";

/** 按 eapi 协议加密请求体(模拟客户端请求;用于对照测试)。 */
export function eapiEncryptBody(url: string, body: Record<string, unknown>): string {
  const text = JSON.stringify(body);
  const message = `nobody${url}use${text}md5forencrypt`;
  const digest = createHash("md5").update(message).digest("hex");
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const cipher = createCipheriv("aes-128-ecb", EAPI_KEY, null);
  return (cipher.update(data, "utf8", "hex") + cipher.final("hex")).toUpperCase();
}

/** 模拟服务端 eapi 响应:AES-ECB 加密 JSON 文本为大写 hex(与 eapiDecrypt 对应)。 */
export function eapiEncryptResponse(body: Record<string, unknown>): string {
  const text = JSON.stringify(body);
  const cipher = createCipheriv("aes-128-ecb", EAPI_KEY, null);
  return (cipher.update(text, "utf8", "hex") + cipher.final("hex")).toUpperCase();
}

export interface MockRequest {
  path: string;
  headers: Record<string, string | undefined>;
  body: string;
}

/** 路由响应:body + 可选自定义响应头(如 Set-Cookie)。 */
export interface RouteResponse {
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface MockNeteaseApi {
  url: string;
  requests: MockRequest[];
  /** 覆盖某个路由的响应(动态控制测试场景)。 */
  setRoute(path: string, handler: () => Record<string, unknown>): void;
  /** 覆盖路由并携带自定义响应头(如登录 Set-Cookie)。 */
  setRouteWithHeaders(path: string, handler: () => RouteResponse): void;
  /** 覆盖 eapi 路由:响应体自动按 eapi 协议加密为 hex(postEapi 调用方解密)。 */
  setEapiRoute(path: string, handler: () => Record<string, unknown>): void;
  /** 注册二进制媒体(如音频)路由。 */
  setMedia(path: string, contentType: string, data: Buffer): void;
  close(): Promise<void>;
}

/** 启动网易云 mock 服务器。 */
export async function startMockNeteaseApi(
  routes: Record<string, () => Record<string, unknown>>,
): Promise<MockNeteaseApi> {
  const requests: MockRequest[] = [];
  const routeMap = new Map(Object.entries(routes));
  const headerRouteMap = new Map<string, () => RouteResponse>();
  const eapiRouteMap = new Map<string, () => Record<string, unknown>>();
  const mediaMap = new Map<string, { contentType: string; data: Buffer }>();

  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    const url = new URL(path, "http://127.0.0.1");
    const pathname = url.pathname;

    // 二进制媒体路由优先。
    const media = mediaMap.get(pathname);
    if (media !== undefined) {
      response.writeHead(200, {
        "content-type": media.contentType,
        "content-length": String(media.data.length),
      });
      response.end(media.data);
      return;
    }

    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        path,
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [key, String(value)]),
        ),
        body,
      });
      const headerHandler = headerRouteMap.get(pathname);
      if (headerHandler !== undefined) {
        const result = headerHandler();
        response.writeHead(200, {
          "content-type": "application/json",
          ...result.headers,
        });
        response.end(JSON.stringify(result.body));
        return;
      }
      const eapiHandler = eapiRouteMap.get(pathname);
      if (eapiHandler !== undefined) {
        // eapi 响应:服务端返回 AES-ECB 加密的 JSON 文本(大写 hex)。
        const encrypted = eapiEncryptResponse(eapiHandler());
        response.writeHead(200, { "content-type": "application/json" });
        response.end(encrypted);
        return;
      }
      const handler = routeMap.get(pathname);
      if (handler === undefined) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: 404, message: "not found" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(handler()));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    setRoute(path, handler) {
      routeMap.set(path, handler);
    },
    setRouteWithHeaders(path, handler) {
      headerRouteMap.set(path, handler);
    },
    setEapiRoute(path, handler) {
      eapiRouteMap.set(path, handler);
    },
    setMedia(path, contentType, data) {
      mediaMap.set(path, { contentType, data });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
