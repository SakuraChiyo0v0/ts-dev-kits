import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FfmpegError,
  type FfmpegClient,
  type ProbeResult,
} from "@amechan/ffmpeg";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface DemoServerOptions {
  ffmpeg: FfmpegClient;
  publicDirectory: string;
}

const assets = new Map<string, readonly [string, string]>([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function errorStatus(code: string): number {
  if (code === "CONFIGURATION" || code === "INVALID_INPUT") {
    return 400;
  }
  if (code === "NOT_FOUND") {
    return 404;
  }
  if (code === "TIMEOUT") {
    return 408;
  }
  return 500;
}

function writeError(response: ServerResponse, error: unknown): void {
  const ffmpegError = error instanceof FfmpegError ? error : undefined;
  const code = ffmpegError?.code ?? "UNKNOWN";
  const message = ffmpegError?.message ?? "Unexpected ffmpeg demo error";
  writeJson(response, errorStatus(code), {
    ok: false,
    error: { code, message },
  });
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) {
      throw new FfmpegError("INVALID_INPUT", `Upload exceeds ${maxBytes} bytes`);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function requestOrigin(server: Server): string | undefined {
  const address = server.address();
  if (!address || typeof address === "string") {
    return undefined;
  }
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

function isSameOriginPost(request: IncomingMessage, server: Server): boolean {
  const origin = requestOrigin(server);
  return (
    origin !== undefined &&
    request.headers.host === origin.slice("http://".length) &&
    request.headers.origin === origin
  );
}

/** 解析 JSON 请求体并做基础类型检查。 */
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const body = (await readBody(request, 1 * 1024 * 1024)).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new FfmpegError("INVALID_INPUT", "Request body must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new FfmpegError("INVALID_INPUT", "Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new FfmpegError("CONFIGURATION", `${name} is required`);
  }
  return value;
}

export function createDemoServer(options: DemoServerOptions): Server {
  // 共享工作目录:本进程内保存上传文件,进程退出时一并清理。
  const workDirectory = mkdtempSync(join(tmpdir(), "ffmpeg-demo-"));

  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

    if (request.method === "GET" && path === "/api/status") {
      writeJson(response, 200, {
        configured: true,
        ffmpegPath: options.ffmpeg.ffmpegPath,
        ffprobePath: options.ffmpeg.ffprobePath,
      });
      return;
    }

    if (request.method === "POST" && path === "/api/upload") {
      if (!isSameOriginPost(request, server)) {
        writeJson(response, 403, {
          ok: false,
          error: { code: "CONFIGURATION", message: "Request origin is not allowed" },
        });
        return;
      }
      try {
        const data = await readBody(request, MAX_UPLOAD_BYTES);
        if (data.length === 0) {
          throw new FfmpegError("INVALID_INPUT", "Upload is empty");
        }
        const filename = `${randomUUID()}.mp4`;
        const filePath = join(workDirectory, filename);
        writeFileSync(filePath, data);
        const info: ProbeResult = await options.ffmpeg.probe(filePath);
        writeJson(response, 200, { ok: true, path: filePath, bytes: data.length, info });
      } catch (error) {
        writeError(response, error);
      }
      return;
    }

    if (request.method === "POST" && path === "/api/transcode") {
      if (!isSameOriginPost(request, server)) {
        writeJson(response, 403, {
          ok: false,
          error: { code: "CONFIGURATION", message: "Request origin is not allowed" },
        });
        return;
      }
      try {
        const body = await readJson(request);
        const input = requiredString(body.input, "input");
        const videoCodec = typeof body.videoCodec === "string" ? body.videoCodec : undefined;
        const output = join(workDirectory, `${randomUUID()}.webm`);
        await options.ffmpeg.transcode({
          input,
          output,
          ...(videoCodec !== undefined ? { videoCodec } : {}),
          overwrite: true,
        });
        writeJson(response, 200, { ok: true, output });
      } catch (error) {
        writeError(response, error);
      }
      return;
    }

    if (request.method === "GET") {
      const asset = assets.get(path);
      if (asset) {
        try {
          const content = readFileSync(join(options.publicDirectory, asset[0]));
          response.writeHead(200, {
            "content-type": asset[1],
            "x-content-type-options": "nosniff",
          });
          response.end(content);
        } catch {
          writeJson(response, 500, {
            ok: false,
            error: { code: "UNKNOWN", message: "Demo asset is unavailable" },
          });
        }
        return;
      }
    }

    if (path.startsWith("/api/")) {
      writeJson(response, 404, {
        ok: false,
        error: { code: "UNKNOWN", message: "API route not found" },
      });
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  // 进程退出时清理工作目录。
  server.on("close", () => {
    rmSync(workDirectory, { recursive: true, force: true });
  });

  return server;
}
