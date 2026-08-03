import { afterEach, describe, expect, it } from "vitest";
import {
  LlmError,
  anthropicAdapter,
  createLlmClient,
  geminiAdapter,
} from "../src/index.js";
import { startMockServer, type MockServer } from "./helpers/mock-server.js";

let mock: MockServer | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe("anthropicAdapter", () => {
  it("converts OpenAI request to Anthropic messages format", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      body: JSON.stringify({
        id: "msg_1",
        content: [{ type: "text", text: "Hi from Claude" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    }));

    const client = createLlmClient({
      adapter: anthropicAdapter({ apiKey: "ant-key", baseUrl: mock.url }),
    });
    const result = await client.chat({
      model: "claude-sonnet-4",
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "hello" },
      ],
    });

    expect(result.provider).toBe("anthropic");
    expect(result.choices[0]?.message.content).toBe("Hi from Claude");
    // system 提取为顶层字段
    expect(mock.requests[0]?.body).toMatchObject({
      model: "claude-sonnet-4",
      system: "You are helpful",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 1024,
    });
    expect(mock.requests[0]?.headers["x-api-key"]).toBe("ant-key");
  });

  it("converts tool_use in response to OpenAI tool_calls", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      body: JSON.stringify({
        id: "msg_2",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "get_weather",
            input: { city: "Beijing" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    }));

    const client = createLlmClient({
      adapter: anthropicAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    const result = await client.chat({
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "weather" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        },
      ],
    });

    expect(result.choices[0]?.finishReason).toBe("tool_calls");
    expect(result.choices[0]?.message.tool_calls?.[0]).toMatchObject({
      id: "toolu_1",
      function: { name: "get_weather" },
    });
  });

  it("maps 401 to AUTHENTICATION", async () => {
    mock = await startMockServer(() => ({
      status: 401,
      body: JSON.stringify({ error: { message: "Invalid API key" } }),
    }));

    const client = createLlmClient({
      adapter: anthropicAdapter({ apiKey: "bad", baseUrl: mock.url }),
    });
    await expect(
      client.chat({ model: "claude-sonnet-4", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ code: "AUTHENTICATION", provider: "anthropic" });
  });
});

describe("geminiAdapter", () => {
  it("converts OpenAI request to Gemini generateContent format", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      body: JSON.stringify({
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hi from Gemini" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4 },
      }),
    }));

    const client = createLlmClient({
      adapter: geminiAdapter({ apiKey: "gem-key", baseUrl: mock.url }),
    });
    const result = await client.chat({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("gemini");
    expect(result.choices[0]?.message.content).toBe("Hi from Gemini");
    expect(mock.requests[0]?.path).toContain("/models/gemini-2.0-flash:generateContent");
    expect(mock.requests[0]?.path).toContain("key=gem-key");
    expect(mock.requests[0]?.body).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
    });
  });

  it("maps 429 to RATE_LIMIT", async () => {
    mock = await startMockServer(() => ({
      status: 429,
      body: JSON.stringify({ error: { message: "Quota exceeded" } }),
    }));

    const client = createLlmClient({
      adapter: geminiAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    await expect(
      client.chat({ model: "gemini-2.0-flash", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ code: "RATE_LIMIT", provider: "gemini" });
  });
});

describe("LlmError", () => {
  it("carries code, status and provider", () => {
    const error = new LlmError("MODEL_NOT_FOUND", "No model", {
      status: 404,
      provider: "openai",
    });
    expect(error.code).toBe("MODEL_NOT_FOUND");
    expect(error.status).toBe(404);
    expect(error.provider).toBe("openai");
    expect(error.message).toBe("No model");
  });
});
