import { afterEach, describe, expect, it } from "vitest";
import {
  createLlmClient,
  openaiAdapter,
} from "../src/index.js";
import { startMockServer, type MockServer } from "./helpers/mock-server.js";

let mock: MockServer | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

function imageResponse(b64?: string, url?: string): string {
  const entry: Record<string, string> = {};
  if (b64 !== undefined) {
    entry.b64_json = b64;
  }
  if (url !== undefined) {
    entry.url = url;
  }
  return JSON.stringify({ created: 123, data: [entry] });
}

describe("generateImage", () => {
  it("sends prompt and returns base64 image", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      body: imageResponse("cGFpbnRlZC1jYXQ="),
    }));

    const client = createLlmClient({
      adapter: openaiAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    const result = await client.generateImage({
      model: "gpt-image-1",
      prompt: "a cat astronaut",
      size: "1024x1024",
    });

    expect(result.provider).toBe("openai");
    expect(result.images[0]?.b64Json).toBe("cGFpbnRlZC1jYXQ=");
    expect(mock.requests[0]?.path).toBe("/images/generations");
    expect(mock.requests[0]?.body).toMatchObject({
      model: "gpt-image-1",
      prompt: "a cat astronaut",
      size: "1024x1024",
      response_format: "b64_json",
    });
  });

  it("returns URL when responseFormat is url", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      body: imageResponse(undefined, "https://example.com/img.png"),
    }));

    const client = createLlmClient({
      adapter: openaiAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    const result = await client.generateImage({
      prompt: "a dog",
      responseFormat: "url",
    });

    expect(result.images[0]?.url).toBe("https://example.com/img.png");
    expect(result.images[0]?.b64Json).toBeUndefined();
  });

  it("maps 429 to RATE_LIMIT", async () => {
    mock = await startMockServer(() => ({
      status: 429,
      body: JSON.stringify({ error: { message: "rate limited" } }),
    }));

    const client = createLlmClient({
      adapter: openaiAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    await expect(client.generateImage({ prompt: "x" })).rejects.toMatchObject({
      code: "RATE_LIMIT",
    });
  });
});

describe("generateImageEdit", () => {
  it("sends multipart form with image and prompt", async () => {
    let contentType = "";
    mock = await startMockServer((path, _body, headers) => {
      contentType = headers["content-type"] ?? "";
      return { status: 200, body: imageResponse("ZWRpdGVk") };
    });

    const client = createLlmClient({
      adapter: openaiAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    const result = await client.generateImageEdit({
      prompt: "make it a sunset",
      image: "data:image/png;base64,aW1n",
    });

    expect(result.images[0]?.b64Json).toBe("ZWRpdGVk");
    expect(mock.requests[0]?.path).toBe("/images/edits");
    expect(contentType.startsWith("multipart/form-data")).toBe(true);
  });
});

describe("generateImageVariation", () => {
  it("sends multipart form with image", async () => {
    let contentType = "";
    mock = await startMockServer((path, _body, headers) => {
      contentType = headers["content-type"] ?? "";
      return { status: 200, body: imageResponse("dmFyaWF0aW9u") };
    });

    const client = createLlmClient({
      adapter: openaiAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    const result = await client.generateImageVariation({
      image: "data:image/png;base64,c2FtcGxl",
      n: 2,
    });

    expect(result.images[0]?.b64Json).toBe("dmFyaWF0aW9u");
    expect(mock.requests[0]?.path).toBe("/images/variations");
    expect(contentType.startsWith("multipart/form-data")).toBe(true);
  });
});

describe("unsupported provider", () => {
  it("throws UNSUPPORTED when adapter lacks image methods", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      body: JSON.stringify({ content: "ok" }),
    }));

    // anthropic 适配器没有图片方法,复用 mock 验证 UNSUPPORTED 错误。
    const { anthropicAdapter } = await import("../src/index.js");
    const client = createLlmClient({
      adapter: anthropicAdapter({ apiKey: "k", baseUrl: mock.url }),
    });
    await expect(async () => client.generateImage({ prompt: "x" })).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
  });
});
