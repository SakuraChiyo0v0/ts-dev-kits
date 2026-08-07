import { LlmError, mapHttpStatus, toLlmError, extractErrorMessage } from "../errors.js";
import { withTimeout } from "../http.js";
/**
 * Anthropic Messages API 适配器。
 * 将 OpenAI 形态请求转换为 Anthropic 的 messages 请求,
 * 响应归一为 OpenAI 形态。
 */
/** 转换消息:OpenAI content 数组/字符串 → Anthropic 的 content 块。 */
function toAnthropicMessages(messages) {
    const result = [];
    for (const message of messages) {
        if (message.role === "system") {
            // system 在 Anthropic 里是顶层字段,调用处单独处理,这里跳过。
            continue;
        }
        if (message.role === "tool") {
            result.push({
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: message.tool_call_id ?? "",
                        content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
                    },
                ],
            });
            continue;
        }
        if (message.role === "assistant" && message.tool_calls && message.tool_calls.length > 0) {
            // assistant 带 tool_calls → Anthropic 的 tool_use 块。
            const blocks = [];
            if (typeof message.content === "string" && message.content !== "") {
                blocks.push({ type: "text", text: message.content });
            }
            for (const call of message.tool_calls) {
                blocks.push({
                    type: "tool_use",
                    id: call.id,
                    name: call.function.name,
                    input: safeParseJson(call.function.arguments),
                });
            }
            result.push({ role: "assistant", content: blocks });
            continue;
        }
        // 普通 user/assistant 消息。
        result.push({
            role: message.role,
            content: toAnthropicContent(message.content),
        });
    }
    return result;
}
function toAnthropicContent(content) {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content.map((part) => {
            if (part.type === "text") {
                return { type: "text", text: part.text };
            }
            if (part.type === "image_url") {
                // 图片需要转成 base64 data URL 格式。
                const url = part.image_url.url;
                return {
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: guessMediaType(url),
                        data: extractBase64(url),
                    },
                };
            }
            if (part.type === "input_audio") {
                return {
                    type: "input_audio",
                    format: part.input_audio.format,
                    data: part.input_audio.data,
                };
            }
            return part;
        });
    }
    return content;
}
function guessMediaType(url) {
    const match = /^data:([^;]+);base64,/u.exec(url);
    if (match) {
        return match[1] ?? "image/png";
    }
    if (/\.png(?:$|\?)/iu.test(url)) {
        return "image/png";
    }
    if (/\.webp(?:$|\?)/iu.test(url)) {
        return "image/webp";
    }
    if (/\.gif(?:$|\?)/iu.test(url)) {
        return "image/gif";
    }
    return "image/jpeg";
}
function extractBase64(url) {
    const match = /^data:[^;]+;base64,(.+)$/su.exec(url);
    return match ? (match[1] ?? "") : url;
}
function safeParseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return {};
    }
}
function extractSystem(messages) {
    const systems = messages
        .filter((message) => message.role === "system")
        .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)));
    return systems.length > 0 ? systems.join("\n\n") : undefined;
}
function toAnthropicRequest(request) {
    return {
        model: request.model,
        ...(extractSystem(request.messages) !== undefined
            ? { system: extractSystem(request.messages) }
            : {}),
        messages: toAnthropicMessages(request.messages),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : { max_tokens: 1024 }),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.stream === true ? { stream: true } : {}),
        ...(request.tools !== undefined
            ? { tools: request.tools.map(toAnthropicTool) }
            : {}),
        ...(request.extra !== undefined ? request.extra : {}),
    };
}
function toAnthropicTool(tool) {
    return {
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
    };
}
/** Anthropic 响应 → OpenAI 形态。 */
function normalizeChatResponse(raw, request) {
    const record = (typeof raw === "object" && raw !== null ? raw : {});
    const content = Array.isArray(record.content) ? record.content : [];
    const text = content
        .filter((block) => typeof block === "object" && block !== null && block.type === "text")
        .map((block) => block.text)
        .join("");
    const toolUses = content
        .filter((block) => typeof block === "object" && block !== null && block.type === "tool_use")
        .map((block) => {
        const b = block;
        return {
            id: String(b.id ?? ""),
            type: "function",
            function: {
                name: String(b.name ?? ""),
                arguments: JSON.stringify(b.input ?? {}),
            },
        };
    });
    const stopReason = typeof record.stop_reason === "string" ? record.stop_reason : null;
    const usageRaw = (typeof record.usage === "object" && record.usage !== null
        ? record.usage
        : {});
    return {
        id: String(record.id ?? "msg_unknown"),
        model: request.model,
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: text,
                    ...(toolUses.length > 0 ? { tool_calls: toolUses } : {}),
                },
                finishReason: mapStopReason(stopReason),
            },
        ],
        usage: {
            promptTokens: Number(usageRaw.input_tokens ?? 0),
            completionTokens: Number(usageRaw.output_tokens ?? 0),
            totalTokens: Number(usageRaw.input_tokens ?? 0) + Number(usageRaw.output_tokens ?? 0),
        },
        provider: "anthropic",
        raw,
    };
}
function mapStopReason(reason) {
    if (reason === null) {
        return null;
    }
    switch (reason) {
        case "end_turn":
        case "stop_sequence":
            return "stop";
        case "max_tokens":
            return "length";
        case "tool_use":
            return "tool_calls";
        default:
            return reason;
    }
}
/** Anthropic 适配器。 */
export function anthropicAdapter(config) {
    const baseUrl = (config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/+$/u, "");
    const timeoutMs = config.timeoutMs ?? 60_000;
    async function chat(request) {
        const response = await rawRequest(`${baseUrl}/messages`, { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }, toAnthropicRequest({ ...request, stream: false }), timeoutMs);
        return normalizeChatResponse(response, request);
    }
    async function chatStream(request, onChunk) {
        const response = await withTimeoutFetch(`${baseUrl}/messages`, {
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }, toAnthropicRequest({ ...request, stream: true }), timeoutMs);
        const reader = response.body?.getReader();
        if (reader === undefined) {
            throw new LlmError("UNKNOWN", "Anthropic stream returned no body", {
                provider: "anthropic",
            });
        }
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        let streamId = `msg_${Date.now()}`;
        // 按 block index 维护工具调用,每个工具累积独立参数缓冲区。
        const toolCalls = new Map();
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";
            for (const eventBlock of events) {
                for (const line of eventBlock.split("\n")) {
                    if (!line.startsWith("data:")) {
                        continue;
                    }
                    const payload = line.slice(5).trim();
                    let event;
                    try {
                        event = JSON.parse(payload);
                    }
                    catch {
                        continue;
                    }
                    const type = String(event.type ?? "");
                    const blockIndex = typeof event.index === "number" ? event.index : 0;
                    if (type === "message_start") {
                        const message = (typeof event.message === "object" && event.message !== null
                            ? event.message
                            : {});
                        if (typeof message.id === "string") {
                            streamId = message.id;
                        }
                    }
                    else if (type === "content_block_delta") {
                        const delta = (typeof event.delta === "object" && event.delta !== null
                            ? event.delta
                            : {});
                        if (delta.type === "text_delta" && typeof delta.text === "string") {
                            fullText += delta.text;
                            onChunk({
                                id: String(blockIndex),
                                model: request.model,
                                choices: [
                                    { index: 0, delta: { content: delta.text }, finishReason: null },
                                ],
                                provider: "anthropic",
                                raw: event,
                            });
                        }
                        if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
                            // partial_json 是增量片段,累积后统一解析。
                            const tool = toolCalls.get(blockIndex);
                            if (tool !== undefined) {
                                tool.inputBuffer += delta.partial_json;
                            }
                        }
                    }
                    else if (type === "content_block_start") {
                        const block = (typeof event.content_block === "object" && event.content_block !== null
                            ? event.content_block
                            : {});
                        if (block.type === "tool_use") {
                            toolCalls.set(blockIndex, {
                                id: String(block.id ?? ""),
                                name: String(block.name ?? ""),
                                inputBuffer: "",
                            });
                        }
                    }
                    else if (type === "message_stop") {
                        // 结束标记。
                    }
                }
            }
        }
        const finalToolCalls = [...toolCalls.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, tc]) => ({
            id: tc.id,
            type: "function",
            function: {
                name: tc.name,
                arguments: tc.inputBuffer.length > 0 ? tc.inputBuffer : "{}",
            },
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
            provider: "anthropic",
            raw: undefined,
        };
    }
    return { name: "anthropic", chat, chatStream };
}
async function rawRequest(url, headers, body, timeoutMs) {
    const response = await withTimeoutFetch(url, headers, body, timeoutMs);
    const text = await withTimeout(response.text(), timeoutMs, "anthropic response body");
    let parsed = null;
    if (text !== "") {
        try {
            parsed = JSON.parse(text);
        }
        catch {
            parsed = text;
        }
    }
    if (!response.ok) {
        const message = extractErrorMessage(parsed, `HTTP ${response.status}`);
        throw new LlmError(mapHttpStatus(response.status, "anthropic"), message, {
            status: response.status,
            provider: "anthropic",
            cause: parsed,
        });
    }
    return parsed;
}
async function withTimeoutFetch(url, headers, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    }
    catch (error) {
        if (controller.signal.aborted) {
            throw new LlmError("TIMEOUT", `anthropic request timed out after ${timeoutMs} ms`, {
                cause: error,
                provider: "anthropic",
            });
        }
        throw toLlmError(error, "anthropic");
    }
    finally {
        clearTimeout(timer);
    }
}
