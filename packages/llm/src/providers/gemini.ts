import { LlmError, mapHttpStatus, toLlmError, extractErrorMessage } from "../errors.js";
import { withTimeout } from "../http.js";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  GeminiProviderConfig,
  ProviderAdapter,
  ToolCall,
} from "../types.js";

/**
 * Google Gemini 适配器。
 * 将 OpenAI 形态请求转换为 Gemini generateContent REST 格式,
 * 响应归一为 OpenAI 形态。
 */

function toGeminiContent(message: ChatMessage): Record<string, unknown> {
  if (typeof message.content === "string") {
    return { role: mapRole(message.role), parts: [{ text: message.content }] };
  }
  const parts = (message.content ?? []).map((part) => {
    if (part.type === "text") {
      return { text: part.text };
    }
    if (part.type === "image_url") {
      return {
        inlineData: {
          mimeType: guessMediaType(part.image_url.url),
          data: extractBase64(part.image_url.url),
        },
      };
    }
    if (part.type === "input_audio") {
      return {
        inlineData: {
          mimeType: `audio/${part.input_audio.format}`,
          data: part.input_audio.data,
        },
      };
    }
    return part;
  });
  return { role: mapRole(message.role), parts };
}

function mapRole(role: ChatMessage["role"]): "user" | "model" | "function" {
  if (role === "assistant") {
    return "model";
  }
  if (role === "tool") {
    return "function";
  }
  return "user";
}

function guessMediaType(url: string): string {
  const match = /^data:([^;]+);base64,/u.exec(url);
  if (match) {
    return match[1] ?? "image/png";
  }
  return "image/png";
}

function extractBase64(url: string): string {
  const match = /^data:[^;]+;base64,(.+)$/su.exec(url);
  return match ? (match[1] ?? "") : url;
}

function toGeminiContents(messages: ChatMessage[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      // Gemini 没有 system 角色,把 system 作为第一条 user 消息开头。
      const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
      result.push({ role: "user", parts: [{ text: `[System instruction]\n${text}` }] });
      continue;
    }
    if (message.role === "tool") {
      result.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: message.name ?? "",
              response: { result: typeof message.content === "string" ? message.content : message.content },
            },
          },
        ],
      });
      continue;
    }
    if (message.role === "assistant" && message.tool_calls && message.tool_calls.length > 0) {
      const parts: Record<string, unknown>[] = [];
      if (typeof message.content === "string" && message.content !== "") {
        parts.push({ text: message.content });
      }
      for (const call of message.tool_calls as ToolCall[]) {
        parts.push({
          functionCall: {
            name: call.function.name,
            args: safeParseJson(call.function.arguments),
          },
        });
      }
      result.push({ role: "model", parts });
      continue;
    }
    result.push(toGeminiContent(message));
  }
  return result;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function toGeminiTool(tool: NonNullable<ChatRequest["tools"]>[number]): Record<string, unknown> {
  return {
    functionDeclarations: [
      {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    ],
  };
}

function toGeminiRequest(request: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: toGeminiContents(request.messages),
  };
  const generationConfig: Record<string, unknown> = {};
  if (request.temperature !== undefined) {
    generationConfig.temperature = request.temperature;
  }
  if (request.maxTokens !== undefined) {
    generationConfig.maxOutputTokens = request.maxTokens;
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }
  if (request.tools !== undefined) {
    body.tools = request.tools.map(toGeminiTool);
  }
  return body;
}

/** Gemini 响应 → OpenAI 形态。 */
function normalizeChatResponse(
  raw: unknown,
  request: ChatRequest,
): ChatResponse {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  const first = (typeof candidates[0] === "object" && candidates[0] !== null
    ? candidates[0]
    : {}) as Record<string, unknown>;
  const content = (typeof first.content === "object" && first.content !== null
    ? first.content
    : {}) as Record<string, unknown>;
  const parts = Array.isArray(content.parts) ? content.parts : [];

  let text = "";
  const toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }> = [];
  for (const part of parts) {
    const partRecord = (typeof part === "object" && part !== null ? part : {}) as Record<string, unknown>;
    if (typeof partRecord.text === "string") {
      text += partRecord.text;
    }
    if (typeof partRecord.functionCall === "object" && partRecord.functionCall !== null) {
      const fc = partRecord.functionCall as Record<string, unknown>;
      toolCalls.push({
        id: `call_${toolCalls.length}`,
        name: String(fc.name ?? ""),
        args: (typeof fc.args === "object" && fc.args !== null ? fc.args : {}) as Record<string, unknown>,
      });
    }
  }

  const finishReason = String(first.finishReason ?? "");
  const usageRaw = (typeof record.usageMetadata === "object" && record.usageMetadata !== null
    ? record.usageMetadata
    : {}) as Record<string, unknown>;

  return {
    id: "gemini-response",
    model: request.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
          ...(toolCalls.length > 0
            ? {
                tool_calls: toolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function" as const,
                  function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                })),
              }
            : {}),
        },
        finishReason: mapFinishReason(finishReason),
      },
    ],
    usage: {
      promptTokens: Number(usageRaw.promptTokenCount ?? 0),
      completionTokens: Number(usageRaw.candidatesTokenCount ?? 0),
      totalTokens:
        Number(usageRaw.promptTokenCount ?? 0) +
        Number(usageRaw.candidatesTokenCount ?? 0),
    },
    provider: "gemini",
    raw,
  };
}

function mapFinishReason(reason: string): string | null {
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
      return "content_filter";
    case "RECITATION":
      return "content_filter";
    case "TOOL_CALLS":
    case "FUNCTION_CALL":
      return "tool_calls";
    case "":
      return null;
    default:
      return reason.toLowerCase();
  }
}

/** Gemini 适配器。 */
export function geminiAdapter(config: GeminiProviderConfig): ProviderAdapter {
  const baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/+$/u,
    "",
  );
  const timeoutMs = config.timeoutMs ?? 60_000;

  function urlFor(model: string, stream: boolean): string {
    const action = stream ? "streamGenerateContent" : "generateContent";
    return `${baseUrl}/models/${model}:${action}?alt=sse&key=${config.apiKey}`;
  }

  async function chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await rawRequest(urlFor(request.model, false), toGeminiRequest(request), timeoutMs);
    return normalizeChatResponse(response, request);
  }

  async function chatStream(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamChunk) => void,
  ): Promise<ChatResponse> {
    const response = await withTimeoutFetch(
      urlFor(request.model, true),
      toGeminiRequest(request),
      timeoutMs,
    );
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new LlmError("UNKNOWN", "Gemini stream returned no body", { provider: "gemini" });
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let streamId = `gemini-${Date.now()}`;
    const streamedToolCalls: Array<{ id: string; name: string; args: string }> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue;
        }
        const normalized = normalizeChatResponse(event, request);
        const choice = normalized.choices[0];
        const chunkText = typeof choice?.message.content === "string" ? choice.message.content : "";
        if (chunkText !== "") {
          fullText += chunkText;
          onChunk({
            id: "gemini-stream",
            model: request.model,
            choices: [{ index: 0, delta: { content: chunkText }, finishReason: null }],
            provider: "gemini",
            raw: event,
          });
        }
        // 流式工具调用:累积 functionCall。
        const toolCalls = choice?.message.tool_calls ?? [];
        for (const toolCall of toolCalls) {
          const id = toolCall.id ?? `call_${streamedToolCalls.length}`;
          const existing = streamedToolCalls.find((tc) => tc.id === id);
          const args = toolCall.function?.arguments ?? "{}";
          if (existing === undefined) {
            streamedToolCalls.push({
              id,
              name: toolCall.function?.name ?? "",
              args,
            });
          } else {
            existing.name = toolCall.function?.name ?? existing.name;
            // Gemini 流式里 functionCall 是完整 JSON,直接替换。
            if (args !== "{}" || existing.args === "{}") {
              existing.args = args;
            }
          }
        }
      }
    }

    const finalToolCalls = streamedToolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.args },
    }));

    return {
      id: streamId,
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: fullText,
            ...(finalToolCalls.length > 0 ? { tool_calls: finalToolCalls } : {}),
          },
          finishReason: "stop",
        },
      ],
      provider: "gemini",
      raw: undefined,
    };
  }

  return { name: "gemini", chat, chatStream };
}

async function rawRequest(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const response = await withTimeoutFetch(url, body, timeoutMs);
  const text = await withTimeout(response.text(), timeoutMs, "gemini response body");
  let parsed: unknown = null;
  if (text !== "") {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    const message = extractErrorMessage(parsed, `HTTP ${response.status}`);
    throw new LlmError(mapHttpStatus(response.status, "gemini"), message, {
      status: response.status,
      provider: "gemini",
      cause: parsed,
    });
  }
  return parsed;
}

async function withTimeoutFetch(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new LlmError("TIMEOUT", `gemini request timed out after ${timeoutMs} ms`, {
        cause: error,
        provider: "gemini",
      });
    }
    throw toLlmError(error, "gemini");
  } finally {
    clearTimeout(timer);
  }
}
