import { afterEach, describe, expect, it } from "vitest";
import {
  anthropicAdapter,
  createLlmClient,
  geminiAdapter,
  openaiAdapter,
} from "../src/index.js";
import { startMockServer, type MockServer } from "./helpers/mock-server.js";

let mock: MockServer | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe("streaming", () => {
  it("parses OpenAI SSE stream and accumulates content", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      contentType: "text/event-stream",
      body: [
        `data: ${JSON.stringify({
          id: "chatcmpl-9",
          model: "gpt-4o",
          choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }],
        })}`,
        `data: ${JSON.stringify({
          id: "chatcmpl-9",
          model: "gpt-4o",
          choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }],
        })}`,
        `data: ${JSON.stringify({
          id: "chatcmpl-9",
          model: "gpt-4o",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}`,
        "data: [DONE]",
      ].join("\n\n"),
    }));

    const client = createLlmClient({
      adapter: openaiAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    const chunks: string[] = [];
    const result = await client.chatStream(
      { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      (chunk) => {
        const text = chunk.choices[0]?.delta.content;
        if (typeof text === "string") {
          chunks.push(text);
        }
      },
    );

    expect(chunks.join("")).toBe("Hello world");
    expect(result.choices[0]?.message.content).toBe("Hello world");
  });

  it("accumulates tool call deltas across chunks", async () => {
    const toolCallChunk1 = {
      id: "chatcmpl-10",
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_weather", arguments: "" } }],
          },
          finish_reason: null,
        },
      ],
    };
    const toolCallChunk2 = {
      id: "chatcmpl-10",
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '{"city":"Shanghai"}' } }],
          },
          finish_reason: null,
        },
      ],
    };

    mock = await startMockServer(() => ({
      status: 200,
      contentType: "text/event-stream",
      body: [
        `data: ${JSON.stringify(toolCallChunk1)}`,
        `data: ${JSON.stringify(toolCallChunk2)}`,
        "data: [DONE]",
      ].join("\n\n"),
    }));

    const client = createLlmClient({
      adapter: openaiAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    const result = await client.chatStream(
      { model: "gpt-4o", messages: [{ role: "user", content: "weather" }] },
      () => undefined,
    );

    expect(result.choices[0]?.message.tool_calls?.[0]).toMatchObject({
      id: "call_1",
      function: { name: "get_weather", arguments: '{"city":"Shanghai"}' },
    });
  });
});

describe("anthropic stream", () => {
  it("accumulates split input_json_delta across chunks", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      contentType: "text/event-stream",
      body: [
        // message_start 携带真实 id
        `data: ${JSON.stringify({ type: "message_start", message: { id: "msg_real_1" } })}`,
        `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "get_weather" } })}`,
        // 分片的 partial_json
        `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"city":' } })}`,
        `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"Shanghai"}' } })}`,
        `data: ${JSON.stringify({ type: "message_stop" })}`,
      ].join("\n\n"),
    }));

    const client = createLlmClient({
      adapter: anthropicAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    const result = await client.chatStream(
      { model: "claude-sonnet-4", messages: [{ role: "user", content: "weather" }] },
      () => undefined,
    );

    expect(result.id).toBe("msg_real_1");
    expect(result.choices[0]?.message.tool_calls?.[0]).toMatchObject({
      id: "toolu_1",
      function: { name: "get_weather", arguments: '{"city":"Shanghai"}' },
    });
  });

  it("supports multiple interleaved tool calls", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      contentType: "text/event-stream",
      body: [
        `data: ${JSON.stringify({ type: "message_start", message: { id: "msg_2" } })}`,
        `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_0", name: "get_weather" } })}`,
        `data: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "get_time" } })}`,
        `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"city":"Shanghai"}' } })}`,
        `data: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"tz":"UTC"}' } })}`,
        `data: ${JSON.stringify({ type: "message_stop" })}`,
      ].join("\n\n"),
    }));

    const client = createLlmClient({
      adapter: anthropicAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    const result = await client.chatStream(
      { model: "claude-sonnet-4", messages: [{ role: "user", content: "hi" }] },
      () => undefined,
    );

    const calls = result.choices[0]?.message.tool_calls;
    expect(calls).toHaveLength(2);
    expect(calls?.[0]).toMatchObject({
      id: "toolu_0",
      function: { name: "get_weather", arguments: '{"city":"Shanghai"}' },
    });
    expect(calls?.[1]).toMatchObject({
      id: "toolu_1",
      function: { name: "get_time", arguments: '{"tz":"UTC"}' },
    });
  });
});

describe("gemini stream", () => {
  it("accumulates functionCall across chunks", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "get_weather", args: { city: "Beijing" } } }],
            },
            finishReason: "TOOL_CALLS",
          },
        ],
      })}\n\n`,
    }));

    const client = createLlmClient({
      adapter: geminiAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    const result = await client.chatStream(
      { model: "gemini-2.0-flash", messages: [{ role: "user", content: "weather" }] },
      () => undefined,
    );

    expect(result.choices[0]?.message.tool_calls?.[0]).toMatchObject({
      function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
    });
  });
});
