import https from "node:https";

export type HttpResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
};

export type HttpRequestOptions = {
  headers?: Record<string, string>;
  body?: Buffer | string;
  cookie?: string;
  timeoutMs?: number;
};

/** 底层 HTTPS 请求（host 直连，带超时与 Cookie 透传） */
export function httpRequest(
  host: string,
  method: string,
  path: string,
  opts: HttpRequestOptions = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const data = opts.body == null ? undefined : Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body);
    const headers: Record<string, string> = {
      Host: host,
      "User-Agent": "Mozilla/5.0 (compatible; ugreen-sdk)",
      ...(opts.headers ?? {}),
    };
    if (data) headers["Content-Length"] = String(data.length);
    if (opts.cookie) headers["Cookie"] = opts.cookie;
    const req = https.request({ host, path, method, headers, timeout: opts.timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers as Record<string, string | string[] | undefined>,
          body: Buffer.concat(chunks),
        })
      );
    });
    req.on("timeout", () => req.destroy(new Error(`请求超时（> ${opts.timeoutMs ?? 30000}ms）`)));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
