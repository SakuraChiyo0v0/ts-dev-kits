# @amechan/llm

OpenAI 兼容的多提供商 LLM 客户端。统一接口调用 OpenAI、Anthropic Claude、Google Gemini、Azure OpenAI,内置格式转换与错误归一化,附带一个轻量 OpenAI 兼容 HTTP 代理。

## 环境要求

- Node.js 20 或更高版本
- 使用各提供商时需对应的 API Key

## 安装

同一 pnpm workspace 内:

```powershell
pnpm add @amechan/llm@workspace:*
```

从私有 GitHub monorepo 使用(需先在消费项目 `pnpm-workspace.yaml` 中授权构建脚本):

```yaml
allowBuilds:
  '@amechan/llm@git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git': true
```

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/llm"
```

## 快速开始

```ts
import { createLlmClient, openaiAdapter } from "@amechan/llm";

const client = createLlmClient({
  adapter: openaiAdapter({ apiKey: process.env.OPENAI_API_KEY! }),
});

const result = await client.chat({
  model: "gpt-4o",
  messages: [{ role: "user", content: "你好" }],
});
console.log(result.choices[0]?.message.content);
```

## 各提供商接入

```ts
// Anthropic Claude
import { anthropicAdapter } from "@amechan/llm";
const client = createLlmClient({
  adapter: anthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});
await client.chat({ model: "claude-sonnet-4", messages: [{ role: "user", content: "hi" }] });

// Google Gemini
import { geminiAdapter } from "@amechan/llm";
const client = createLlmClient({
  adapter: geminiAdapter({ apiKey: process.env.GEMINI_API_KEY! }),
});
await client.chat({ model: "gemini-2.0-flash", messages: [{ role: "user", content: "hi" }] });

// Azure OpenAI
import { azureAdapter } from "@amechan/llm";
const client = createLlmClient({
  adapter: azureAdapter({
    apiKey: process.env.AZURE_OPENAI_KEY!,
    baseUrl: "https://my-resource.openai.azure.com/openai",
    deployment: "my-deployment",
  }),
});
await client.chat({ model: "ignored", messages: [{ role: "user", content: "hi" }] }); // 用 deployment
```

## OpenAI 兼容提供商注册表

大量提供商使用 OpenAI 兼容协议,只需一行即可接入。内置注册表覆盖常见提供商:

| id | 提供商 | baseUrl | 推荐模型 |
| --- | --- | --- | --- |
| `openai` | OpenAI | `https://api.openai.com/v1` | gpt-4o, gpt-4o-mini |
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | deepseek-chat, deepseek-reasoner |
| `moonshot` | Moonshot AI (Kimi) | `https://api.moonshot.cn/v1` | moonshot-v1-8k, moonshot-v1-32k |
| `zhipu` | 智谱 AI (BigModel) | `https://open.bigmodel.cn/api/paas/v4` | glm-4-plus, glm-4-flash |
| `groq` | Groq | `https://api.groq.com/openai/v1` | llama-3.3-70b-versatile |
| `together` | Together AI | `https://api.together.xyz/v1` | Llama-3.3-70B |
| `fireworks` | Fireworks AI | `https://api.fireworks.ai/inference/v1` | llama-v3p1-70b |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | openai/gpt-4o, anthropic/claude-sonnet-4 |
| `perplexity` | Perplexity | `https://api.perplexity.ai` | sonar-pro, sonar |
| `mistral` | Mistral AI | `https://api.mistral.ai/v1` | mistral-large-latest |
| `aliyun` | 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen-plus, qwen-turbo |
| `ollama` | Ollama (本地) | `http://localhost:11434/v1` | llama3.1, qwen2.5 |
| `vllm` | vLLM (自部署) | `http://localhost:8000/v1` | — |
| `lmstudio` | LM Studio (本地) | `http://localhost:1234/v1` | — |

按 id 创建客户端:

```ts
import { createLlmClient, createProviderAdapter, listProviders } from "@amechan/llm";

// 查看所有可用提供商
console.log(listProviders());

// 按 id 创建(自动使用该提供商的 baseUrl 和认证)
const client = createLlmClient({
  adapter: createProviderAdapter("deepseek", process.env.DEEPSEEK_API_KEY!),
});
await client.chat({ model: "deepseek-chat", messages: [{ role: "user", content: "hi" }] });
```

注册自定义 OpenAI 兼容端点(如内网代理或自部署服务):

```ts
import { createLlmClient, createProviderAdapter, registerProvider } from "@amechan/llm";

registerProvider({
  id: "my-internal",
  name: "My Internal Gateway",
  baseUrl: "https://gateway.internal.example.com/v1",
  defaultModels: ["gpt-4o"],
});

const client = createLlmClient({
  adapter: createProviderAdapter("my-internal", process.env.GATEWAY_KEY!),
});
```

自定义认证头(非 Bearer,如 x-api-key):

```ts
registerProvider({
  id: "x-ai",
  name: "xAI",
  baseUrl: "https://api.x.ai/v1",
  defaultModels: ["grok-2"],
  auth: { header: "x-api-key", value: (apiKey) => apiKey },
});
```

统一适配器工厂:

```ts
import { createLlmClient, openaiAdapter, anthropicAdapter, geminiAdapter, azureAdapter } from "@amechan/llm";

function makeClient(provider: "openai" | "anthropic" | "gemini" | "azure", apiKey: string) {
  const adapters = {
    openai: () => openaiAdapter({ apiKey }),
    anthropic: () => anthropicAdapter({ apiKey }),
    gemini: () => geminiAdapter({ apiKey }),
    azure: () => azureAdapter({ apiKey, baseUrl: process.env.AZURE_BASE_URL!, deployment: process.env.AZURE_DEPLOYMENT! }),
  };
  return createLlmClient({ adapter: adapters[provider]() });
}
```

## 请求格式(OpenAI 兼容)

```ts
await client.chat({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "You are helpful" },
    { role: "user", content: "讲个笑话" },
  ],
  temperature: 0.7,
  maxTokens: 512,
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather for a city",
        parameters: { type: "object", properties: { city: { type: "string" } } },
      },
    },
  ],
  toolChoice: "auto",
});
```

多模态(图片输入):

```ts
await client.chat({
  model: "gpt-4o",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "这张图里有什么?" },
        { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
      ],
    },
  ],
});
```

## 流式输出

```ts
const result = await client.chatStream(
  { model: "gpt-4o", messages: [{ role: "user", content: "写首诗" }] },
  (chunk) => {
    const text = chunk.choices[0]?.delta.content;
    if (text) process.stdout.write(text);
  },
);
// 流结束后 result 含完整内容
```

## 响应格式

```ts
interface ChatResponse {
  id: string;
  model: string;
  choices: [{ index: number; message: ChatMessage; finishReason: string | null }];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  provider: string;   // openai / anthropic / gemini / azure
  raw: unknown;
}
```

## 错误处理

统一 `LlmError`,错误码:

| 错误码 | 含义 |
| --- | --- |
| `AUTHENTICATION` | API Key 无效(401/403) |
| `RATE_LIMIT` | 触发限流(429) |
| `TIMEOUT` | 请求超时 |
| `INVALID_REQUEST` | 请求格式错误(400/422) |
| `MODEL_NOT_FOUND` | 模型不存在(404) |
| `OVERLOADED` | 服务过载(529) |
| `NETWORK` | 网络连接失败 |
| `UNKNOWN` | 未能分类 |

```ts
import { LlmError } from "@amechan/llm";
try {
  await client.chat(request);
} catch (error) {
  if (error instanceof LlmError) {
    console.error(error.code, error.message, error.provider, error.status);
  }
}
```

注意:
- `LlmError.message` 已提取并可用于展示;`error.cause` 是提供商原始响应,可能含请求回显内容,**不要把 cause 直接写进日志**,如需排查先做脱敏。
- Gemini 没有独立的 system 角色,SDK 会把 system 消息拼到第一条 user 消息前加 `[System instruction]` 前缀,行为与原生 system 有差异,请在需要强 system 语义时优先使用其他提供商。

各家错误会自动归一:例如 Anthropic 的 401、Gemini 的 403、OpenAI 的 401 都变成 `AUTHENTICATION`。

## 图片生成

OpenAI 兼容的图片能力:`generateImage`(生成)、`generateImageEdit`(编辑)、`generateImageVariation`(变体)。支持 base64 与 URL 返回。

```ts
const client = createLlmClient({
  adapter: openaiAdapter({ apiKey: process.env.OPENAI_API_KEY! }),
});

// 生成
const result = await client.generateImage({
  model: "gpt-image-1",
  prompt: "a cat astronaut",
  size: "1024x1024",
});
console.log(result.images[0]?.b64Json); // base64 图片数据

// 编辑(基于原图,multipart 上传)
await client.generateImageEdit({
  prompt: "make it a sunset",
  image: "data:image/png;base64,...",   // 原图 base64 或 data URL
});

// 变体
await client.generateImageVariation({
  image: "data:image/png;base64,...",
  n: 2,
});
```

请求参数: `prompt`(必填)、`model?`、`size?`(`1024x1024` 等)、`n?`、`responseFormat?`(`"b64_json"` 默认 / `"url"`)、`quality?`(standard/hd)、`style?`(vivid/natural)。

未实现图片能力的适配器(如 anthropic、gemini)调用时会抛 `LlmError("UNSUPPORTED")`。

## HTTP 代理模式

把 SDK 暴露为 OpenAI 兼容的本地服务,任何 OpenAI SDK 客户端都能连接:

```ts
import { createLlmProxy, openaiAdapter } from "@amechan/llm";

const server = createLlmProxy({
  adapter: openaiAdapter({ apiKey: process.env.OPENAI_API_KEY! }),
  defaultModel: "gpt-4o",
});
server.listen(3000, "127.0.0.1", () => {
  console.log("LLM proxy on http://127.0.0.1:3000");
});
```

然后任何 OpenAI 兼容客户端指向 `http://127.0.0.1:3000/v1` 即可:

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'
```

支持流式:`stream: true` 时返回 SSE。

## 自定义适配器

实现 `ProviderAdapter` 接口即可接入任意提供商:

```ts
import type { ProviderAdapter } from "@amechan/llm";

const myAdapter: ProviderAdapter = {
  name: "my-provider",
  async chat(request) { /* 转换请求并发送,返回统一响应 */ },
  async chatStream(request, onChunk) { /* 流式实现 */ },
};
```

## 注意事项

- `maxTokens` 字段在 Anthropic 是必填,未提供时 SDK 默认 `1024`。
- Azure 的 `model` 字段被忽略,实际使用 `deployment`。
- 各提供商超时默认 60 秒,可用 `timeoutMs` 覆盖。
- 凭据应从环境变量/配置系统读取,不要硬编码。

## 验证命令

```powershell
pnpm --filter @amechan/llm typecheck
pnpm --filter @amechan/llm test
pnpm --filter @amechan/llm build
```
