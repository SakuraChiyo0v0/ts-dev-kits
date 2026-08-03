import { afterEach, describe, expect, it } from "vitest";
import {
  createLlmClient,
  createProviderAdapter,
  getProviderEntry,
  listProviders,
  registerProvider,
} from "../src/index.js";
import { startMockServer, type MockServer } from "./helpers/mock-server.js";

let mock: MockServer | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe("provider registry", () => {
  it("lists registered OpenAI-compatible providers", () => {
    const providers = listProviders();
    expect(providers).toContain("openai");
    expect(providers).toContain("deepseek");
    expect(providers).toContain("groq");
    expect(providers).toContain("ollama");
    // 至少有一批已录入
    expect(providers.length).toBeGreaterThanOrEqual(10);
  });

  it("gets entry metadata for a known provider", () => {
    const entry = getProviderEntry("deepseek");
    expect(entry.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(entry.defaultModels.length).toBeGreaterThan(0);
  });

  it("throws CONFIGURATION for unknown provider", () => {
    expect(() => getProviderEntry("not-a-provider")).toThrow(/Unknown provider/);
  });

  it("creates an adapter that routes to the provider baseUrl", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      body: JSON.stringify({
        id: "chatcmpl-r",
        model: "deepseek-chat",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      }),
    }));

    // 覆盖 baseUrl 指向 mock,验证路由与认证头。
    const adapter = createProviderAdapter("deepseek", "ds-key", { baseUrl: mock.url });
    const client = createLlmClient({ adapter });
    const result = await client.chat({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.choices[0]?.message.content).toBe("ok");
    expect(mock.requests[0]?.headers.authorization).toBe("Bearer ds-key");
  });

  it("registers a custom provider at runtime", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      body: JSON.stringify({
        id: "chatcmpl-x",
        model: "custom-model",
        choices: [{ index: 0, message: { role: "assistant", content: "custom" }, finish_reason: "stop" }],
      }),
    }));

    registerProvider({
      id: "my-corp",
      name: "My Corp",
      baseUrl: mock.url,
      defaultModels: ["custom-model"],
    });

    const adapter = createProviderAdapter("my-corp", "corp-key");
    const client = createLlmClient({ adapter });
    const result = await client.chat({
      model: "custom-model",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.choices[0]?.message.content).toBe("custom");
    expect(mock.requests[0]?.headers.authorization).toBe("Bearer corp-key");
  });

  it("supports custom auth header providers", async () => {
    mock = await startMockServer(() => ({
      status: 200,
      body: JSON.stringify({
        id: "chatcmpl-y",
        model: "m",
        choices: [{ index: 0, message: { role: "assistant", content: "auth" }, finish_reason: "stop" }],
      }),
    }));

    registerProvider({
      id: "x-ai",
      name: "xAI",
      baseUrl: mock.url,
      defaultModels: ["grok"],
      auth: { header: "x-api-key", value: (apiKey) => apiKey },
    });

    const adapter = createProviderAdapter("x-ai", "xai-key");
    const client = createLlmClient({ adapter });
    await client.chat({ model: "grok", messages: [{ role: "user", content: "hi" }] });

    expect(mock.requests[0]?.headers["x-api-key"]).toBe("xai-key");
  });
});
