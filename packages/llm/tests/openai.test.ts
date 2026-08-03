import { afterEach, describe, expect, it } from "vitest";
import { createLlmClient, LlmError, azureAdapter, openaiAdapter } from "../src/index.js";
import { startMockServer, type MockServer } from "./helpers/mock-server.js";

let mock: MockServer | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe("openaiAdapter", () => {
  it("sends OpenAI-format request and normalizes response", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      body: JSON.stringify({
        id: "chatcmpl-1",
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    }));

    const client = createLlmClient({
      adapter: openaiAdapter({ apiKey: "test-key", baseUrl: mock.url }),
    });
    const result = await client.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.provider).toBe("openai");
    expect(result.choices[0]?.message.content).toBe("Hello!");
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(mock.requests[0]?.body).toMatchObject({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(mock.requests[0]?.headers.authorization).toBe("Bearer test-key");
  });

  it("maps 401 to AUTHENTICATION error", async () => {
    mock = await startMockServer(() => ({
      status: 401,
      body: JSON.stringify({ error: { message: "Invalid API key" } }),
    }));

    const client = createLlmClient({
      adapter: openaiAdapter({ apiKey: "bad-key", baseUrl: mock.url }),
    });
    await expect(
      client.chat({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ code: "AUTHENTICATION" });
  });

  it("maps 429 to RATE_LIMIT error", async () => {
    mock = await startMockServer(() => ({
      status: 429,
      body: JSON.stringify({ error: { message: "Rate limited" } }),
    }));

    const client = createLlmClient({
      adapter: openaiAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    await expect(
      client.chat({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });

  it("sends tools in the request", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      body: JSON.stringify({
        id: "chatcmpl-2",
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city":"Shanghai"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    }));

    const client = createLlmClient({
      adapter: openaiAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    const result = await client.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "weather?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        },
      ],
    });

    expect(result.choices[0]?.message.tool_calls?.[0]?.function.name).toBe("get_weather");
    expect(mock.requests[0]?.body).toMatchObject({ tools: expect.any(Array) });
  });
});

describe("azureAdapter", () => {
  it("routes to azure deployment endpoint", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      body: JSON.stringify({
        id: "chatcmpl-3",
        model: "gpt-4o",
        choices: [{ index: 0, message: { role: "assistant", content: "Azure!" }, finish_reason: "stop" }],
      }),
    }));

    const client = createLlmClient({
      adapter: azureAdapter({
        apiKey: "azure-key",
        baseUrl: mock.url,
        deployment: "my-deployment",
      }),
    });
    const result = await client.chat({
      model: "whatever", // azure 忽略,用 deployment
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.provider).toBe("azure");
    expect(result.choices[0]?.message.content).toBe("Azure!");
    expect(mock.requests[0]?.path).toContain(
      "/openai/deployments/my-deployment/chat/completions",
    );
    expect(mock.requests[0]?.path).toContain("api-version=");
    expect(mock.requests[0]?.headers["api-key"]).toBe("azure-key");
  });
});

describe("error normalization", () => {
  it("LlmError carries code and provider", async () => {
    mock = await startMockServer(() => ({
      status: 500,
      body: JSON.stringify({ error: { message: "boom" } }),
    }));

    const client = createLlmClient({
      adapter: openaiAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    try {
      await client.chat({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).code).toBe("UNKNOWN");
      expect((error as LlmError).provider).toBe("openai");
      expect((error as LlmError).status).toBe(500);
    }
  });
});
