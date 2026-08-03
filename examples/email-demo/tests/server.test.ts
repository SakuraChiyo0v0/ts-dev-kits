import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EmailError, type EmailClient, type EmailMessage } from "@amechan/email";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_REQUEST_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  createDemoServer,
} from "../src/server.js";

function publicFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "amechan-email-demo-public-"));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "index.html"), "<!doctype html><title>fixture</title>");
  writeFileSync(join(directory, "app.js"), "console.log('fixture');");
  writeFileSync(join(directory, "styles.css"), "body { color: black; }");
  return directory;
}

describe("email demo server", () => {
  const verify = vi.fn<() => Promise<void>>();
  const send = vi.fn<(message: EmailMessage) => Promise<{
    provider: string;
    messageId: string;
    accepted: string[];
    rejected: string[];
    response: string;
  }>>();
  const close = vi.fn<() => Promise<void>>();
  const client = { verify, send, close } as unknown as EmailClient;
  let server: ReturnType<typeof createDemoServer>;
  let origin: string;

  beforeEach(async () => {
    verify.mockReset().mockResolvedValue(undefined);
    send.mockReset().mockResolvedValue({
      provider: "fake",
      messageId: "message-1",
      accepted: ["to@example.com"],
      rejected: [],
      response: "queued",
    });
    close.mockReset().mockResolvedValue(undefined);
    server = createDemoServer({
      client,
      defaultFrom: "Demo <demo@example.com>",
      publicDirectory: publicFixture(),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const post = (path: string, body?: unknown, requestOrigin = origin) =>
    fetch(`${origin}${path}`, {
      method: "POST",
      headers: {
        origin: requestOrigin,
        "content-type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });

  it("reports configuration status without returning credentials", async () => {
    const response = await fetch(`${origin}/api/status`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      configured: true,
      defaultFrom: "Demo <demo@example.com>",
    });
    expect(text).not.toMatch(/password|smtp|credential/iu);
  });

  it("rejects POST requests with a foreign Origin", async () => {
    const response = await post("/api/verify", {}, "https://example.com");

    expect(response.status).toBe(403);
    expect(verify).not.toHaveBeenCalled();
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("rejects POST requests with a foreign Host", async () => {
    const url = new URL(origin);
    const statusCode = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest({
        hostname: url.hostname,
        port: url.port,
        path: "/api/verify",
        method: "POST",
        headers: {
          host: "localhost.invalid",
          origin,
          "content-type": "application/json",
          "content-length": 2,
        },
      });
      request.once("error", reject);
      request.once("response", (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      });
      request.end("{}");
    });

    expect(statusCode).toBe(403);
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects request bodies larger than 14 MiB", async () => {
    const response = await fetch(`${origin}/api/send`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ padding: "x".repeat(MAX_REQUEST_BYTES + 1) }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "Request body exceeds 14 MiB",
      },
    });
    expect(send).not.toHaveBeenCalled();
  }, 20_000);

  it("calls client.verify for a same-origin verify request", async () => {
    const response = await post("/api/verify");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(verify).toHaveBeenCalledOnce();
  });

  it("maps a valid send request and base64 attachment to EmailMessage", async () => {
    const bytes = Buffer.from("hello attachment");
    const response = await post("/api/send", {
      from: "from@example.com",
      to: ["to@example.com"],
      cc: ["cc@example.com"],
      bcc: [],
      replyTo: ["reply@example.com"],
      subject: "Demo",
      text: "plain",
      html: "<strong>html</strong>",
      attachments: [
        {
          filename: "hello.txt",
          contentType: "text/plain",
          contentBase64: bytes.toString("base64"),
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
    const message = send.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      from: "from@example.com",
      to: ["to@example.com"],
      cc: ["cc@example.com"],
      replyTo: ["reply@example.com"],
      subject: "Demo",
      text: "plain",
      html: "<strong>html</strong>",
    });
    expect(message?.attachments?.[0]?.content).toEqual(bytes);
  });

  it("rejects an attachment larger than 5 MiB and total attachments larger than 10 MiB", async () => {
    const oversized = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString("base64");
    const oneResponse = await post("/api/send", {
      from: "from@example.com",
      to: ["to@example.com"],
      subject: "Too large",
      text: "body",
      attachments: [{ filename: "large.bin", contentBase64: oversized }],
    });
    expect(oneResponse.status).toBe(400);

    const first = Buffer.alloc(MAX_ATTACHMENT_BYTES).toString("base64");
    const second = Buffer.alloc(MAX_TOTAL_ATTACHMENT_BYTES - MAX_ATTACHMENT_BYTES)
      .toString("base64");
    const totalResponse = await post("/api/send", {
      from: "from@example.com",
      to: ["to@example.com"],
      subject: "Too large in total",
      text: "body",
      attachments: [
        { filename: "one.bin", contentBase64: first },
        { filename: "two.bin", contentBase64: second },
        { filename: "three.bin", contentBase64: "AA==" },
      ],
    });
    expect(totalResponse.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  }, 20_000);

  it("serializes EmailError as code and safe message without cause", async () => {
    send.mockRejectedValueOnce(
      new EmailError("DELIVERY", "Mailbox rejected", {
        cause: new Error("secret provider detail"),
      }),
    );
    const response = await post("/api/send", {
      from: "from@example.com",
      to: ["to@example.com"],
      subject: "Failure",
      text: "body",
    });
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(text)).toEqual({
      ok: false,
      error: { code: "DELIVERY", message: "Mailbox rejected" },
    });
    expect(text).not.toMatch(/cause|stack|secret provider detail/iu);
  });

  it("serves index.html, app.js and styles.css from fixed paths only", async () => {
    for (const [path, contentType] of [
      ["/", "text/html"],
      ["/app.js", "text/javascript"],
      ["/styles.css", "text/css"],
    ] as const) {
      const response = await fetch(`${origin}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(contentType);
    }

    expect((await fetch(`${origin}/.env`)).status).toBe(404);
    expect((await fetch(`${origin}/%2e%2e/.env`)).status).toBe(404);
  });

  it("serves the functional bundled UI", async () => {
    const uiServer = createDemoServer({
      client,
      publicDirectory: resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../public",
      ),
    });
    await new Promise<void>((resolveListen) =>
      uiServer.listen(0, "127.0.0.1", resolveListen),
    );
    const address = uiServer.address() as AddressInfo;
    const uiOrigin = `http://127.0.0.1:${address.port}`;

    try {
      const indexResponse = await fetch(`${uiOrigin}/`);
      const index = await indexResponse.text();
      expect(indexResponse.status).toBe(200);
      expect(index).toContain("data-email-form");
      expect(index).toContain('sandbox=""');

      const scriptResponse = await fetch(`${uiOrigin}/app.js`);
      const script = await scriptResponse.text();
      expect(scriptResponse.status).toBe(200);
      expect(script).toContain("/api/send");

      const styleResponse = await fetch(`${uiOrigin}/styles.css`);
      const style = await styleResponse.text();
      expect(styleResponse.status).toBe(200);
      expect(style).toContain("@media (max-width: 800px)");
    } finally {
      await new Promise<void>((resolveClose, reject) =>
        uiServer.close((error) => (error ? reject(error) : resolveClose())),
      );
    }
  });
});
