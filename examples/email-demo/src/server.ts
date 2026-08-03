import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import {
  EmailError,
  type EmailAttachment,
  type EmailClient,
  type EmailErrorCode,
  type EmailMessage,
} from "@amechan/email";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 14 * 1024 * 1024;

export interface DemoServerOptions {
  client: EmailClient;
  defaultFrom?: string;
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

function writeText(
  response: ServerResponse,
  status: number,
  value: string,
  contentType = "text/plain; charset=utf-8",
): void {
  response.writeHead(status, {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  });
  response.end(value);
}

function errorStatus(code: EmailErrorCode): number {
  if (code === "VALIDATION" || code === "CONFIGURATION") {
    return 400;
  }
  return 502;
}

function writeError(response: ServerResponse, error: unknown): void {
  const code: EmailErrorCode = error instanceof EmailError ? error.code : "UNKNOWN";
  const message =
    error instanceof EmailError ? error.message : "Unexpected email demo error";
  writeJson(response, errorStatus(code), {
    ok: false,
    error: { code, message },
  });
}

function requestOrigin(server: Server): string | undefined {
  const address = server.address();
  if (!address || typeof address === "string") {
    return undefined;
  }
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

function isSameOriginPost(
  request: IncomingMessage,
  server: Server,
): boolean {
  const origin = requestOrigin(server);
  return (
    origin !== undefined &&
    request.headers.host === origin.slice("http://".length) &&
    request.headers.origin === origin
  );
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new EmailError("VALIDATION", "Content-Type must be application/json");
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new EmailError("VALIDATION", "Request body exceeds 14 MiB");
    }
    chunks.push(bytes);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new EmailError("VALIDATION", "Request body must be valid JSON");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EmailError("VALIDATION", "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new EmailError("VALIDATION", `${name} is required`);
  }
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new EmailError("VALIDATION", `${name} must be a string`);
  }
  return value;
}

function addresses(value: unknown, name: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new EmailError("VALIDATION", `${name} must be an array of addresses`);
  }
  const result = value.map((item) => item.trim()).filter(Boolean);
  return result.length > 0 ? result : undefined;
}

function decodeBase64(value: unknown, filename: string): Buffer {
  if (typeof value !== "string" || value.length % 4 !== 0) {
    throw new EmailError("VALIDATION", `${filename} has invalid base64 content`);
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const contentLength = value.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index);
    const valid =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 43 ||
      code === 47;
    if (!valid) {
      throw new EmailError("VALIDATION", `${filename} has invalid base64 content`);
    }
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value[index] !== "=") {
      throw new EmailError("VALIDATION", `${filename} has invalid base64 content`);
    }
  }
  if ((padding === 1 && contentLength % 4 !== 3) || (padding === 2 && contentLength % 4 !== 2)) {
    throw new EmailError("VALIDATION", `${filename} has invalid base64 content`);
  }
  return Buffer.from(value, "base64");
}

function attachments(value: unknown): EmailAttachment[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new EmailError("VALIDATION", "attachments must be an array");
  }

  let total = 0;
  const result = value.map((item) => {
    const attachment = record(item);
    const filename = requiredString(attachment.filename, "attachment filename");
    const content = decodeBase64(attachment.contentBase64, filename);
    if (content.length > MAX_ATTACHMENT_BYTES) {
      throw new EmailError("VALIDATION", `${filename} exceeds 5 MiB`);
    }
    total += content.length;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new EmailError("VALIDATION", "attachments exceed 10 MiB in total");
    }
    const contentType = optionalString(attachment.contentType, "attachment contentType");
    return {
      filename,
      content,
      ...(contentType ? { contentType } : {}),
    };
  });

  return result.length > 0 ? result : undefined;
}

function emailMessage(value: unknown): EmailMessage {
  const body = record(value);
  const text = optionalString(body.text, "text");
  const html = optionalString(body.html, "html");
  if (text === undefined && html === undefined) {
    throw new EmailError("VALIDATION", "text or html content is required");
  }

  const to = addresses(body.to, "to");
  const cc = addresses(body.cc, "cc");
  const bcc = addresses(body.bcc, "bcc");
  const replyTo = addresses(body.replyTo, "replyTo");
  const decodedAttachments = attachments(body.attachments);

  return {
    from: requiredString(body.from, "from"),
    subject: requiredString(body.subject, "subject"),
    ...(to ? { to } : {}),
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(html !== undefined ? { html } : {}),
    ...(decodedAttachments ? { attachments: decodedAttachments } : {}),
  };
}

export function createDemoServer(options: DemoServerOptions): Server {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

    if (request.method === "GET" && path === "/api/status") {
      writeJson(response, 200, {
        configured: true,
        ...(options.defaultFrom ? { defaultFrom: options.defaultFrom } : {}),
      });
      return;
    }

    if (request.method === "POST" && path.startsWith("/api/")) {
      if (!isSameOriginPost(request, server)) {
        writeJson(response, 403, {
          ok: false,
          error: { code: "VALIDATION", message: "Request origin is not allowed" },
        });
        return;
      }

      try {
        const body = await readJson(request);
        if (path === "/api/verify") {
          await options.client.verify();
          writeJson(response, 200, { ok: true });
          return;
        }
        if (path === "/api/send") {
          const result = await options.client.send(emailMessage(body));
          writeJson(response, 200, { ok: true, result });
          return;
        }
        writeJson(response, 404, {
          ok: false,
          error: { code: "VALIDATION", message: "API route not found" },
        });
      } catch (error) {
        writeError(response, error);
      }
      return;
    }

    if (request.method === "GET") {
      const asset = assets.get(path);
      if (asset) {
        try {
          const content = await readFile(join(options.publicDirectory, asset[0]));
          writeText(response, 200, content.toString("utf8"), asset[1]);
        } catch {
          writeText(response, 500, "Demo asset is unavailable");
        }
        return;
      }
    }

    if (path.startsWith("/api/")) {
      writeJson(response, 404, {
        ok: false,
        error: { code: "VALIDATION", message: "API route not found" },
      });
      return;
    }
    writeText(response, 404, "Not found");
  });

  return server;
}
