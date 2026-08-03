import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createLlmProxy, openaiAdapter } from "../src/index.js";
import { startMockServer, type MockServer } from "./helpers/mock-server.js";

let mock: MockServer | undefined;
let proxy: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => proxy?.close(() => resolve()));
  proxy = undefined;
  await mock?.close();
  mock = undefined;
});

async function startProxy(): Promise<string> {
  mock = await startMockServer(() => ({
    status: 200,
    body: JSON.stringify({
      id: "chatcmpl-proxy",
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "proxy reply" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }),
  }));

  proxy = createLlmProxy({
    adapter: openaiAdapter({ apiKey: "k", baseUrl: mock.url }),
    defaultModel: "gpt-4o",
  });
  await new Promise<void>((resolve) => proxy!.listen(0, "127.0.0.1", resolve));
  const address = proxy!.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("createLlmProxy", () => {
  it("exposes /v1/chat/completions and forwards to adapter", async () => {
    const base = await startProxy();
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      object: string;
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage: { total_tokens: number };
    };
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0]?.message.content).toBe("proxy reply");
    expect(body.choices[0]?.finish_reason).toBe("stop");
    expect(body.usage.total_tokens).toBe(3);
    expect(mock?.requests[0]?.body).toMatchObject({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("returns 404 for unknown routes", async () => {
    const base = await startProxy();
    const response = await fetch(`${base}/v1/unknown`);
    expect(response.status).toBe(404);
  });

  it("rejects missing messages", async () => {
    const base = await startProxy();
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o" }),
    });
    expect(response.status).toBe(400);
  });
});
