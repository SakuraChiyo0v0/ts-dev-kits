'use strict';

var node_http = require('node:http');

class LlmError extends Error {
    code;
    /** HTTP 状态码(如来自 HTTP 响应)。 */
    status;
    /** 提供商原始错误信息。 */
    provider;
    constructor(code, message, options) {
        super(message, options);
        this.name = "LlmError";
        this.code = code;
        if (options?.status !== undefined) {
            this.status = options.status;
        }
        if (options?.provider !== undefined) {
            this.provider = options.provider;
        }
    }
}
/** 把 HTTP 状态码映射为统一错误码。 */
function mapHttpStatus(status, provider) {
    if (status === 401 || status === 403) {
        return "AUTHENTICATION";
    }
    if (status === 429) {
        return "RATE_LIMIT";
    }
    if (status === 404) {
        return "MODEL_NOT_FOUND";
    }
    if (status >= 500) {
        return status === 529 ? "OVERLOADED" : "UNKNOWN";
    }
    if (status === 400 || status === 422) {
        return "INVALID_REQUEST";
    }
    return "UNKNOWN";
}
/** 从任意错误构造 LlmError。 */
function toLlmError(error, provider) {
    if (error instanceof LlmError) {
        return error;
    }
    const record = (typeof error === "object" && error !== null ? error : {});
    const status = typeof record.status === "number" ? record.status : undefined;
    const message = error instanceof Error ? error.message : "Unknown LLM error";
    if (status !== undefined) {
        return new LlmError(mapHttpStatus(status), message, {
            cause: error,
            status,
            provider,
        });
    }
    // fetch 网络错误
    if (message.includes("fetch failed") ||
        message.includes("ENOTFOUND") ||
        message.includes("ECONNREFUSED") ||
        message.includes("network")) {
        return new LlmError("NETWORK", message, { cause: error, provider });
    }
    return new LlmError("UNKNOWN", message, { cause: error, provider });
}
/** 解析提供商错误响应的 JSON body 里的 message。 */
function extractErrorMessage(body, fallback) {
    if (typeof body !== "object" || body === null) {
        return fallback;
    }
    const record = body;
    if (typeof record.error === "object" && record.error !== null) {
        const err = record.error;
        if (typeof err.message === "string") {
            return err.message;
        }
    }
    if (typeof record.message === "string") {
        return record.message;
    }
    return fallback;
}

/** 统一 LLM 客户端。 */
class LLMClient {
    #adapter;
    constructor(options) {
        this.#adapter = options.adapter;
    }
    /** 适配器名称,如 openai / anthropic / gemini / azure。 */
    get provider() {
        return this.#adapter.name;
    }
    /** 非流式聊天补全。 */
    chat(request) {
        return this.#adapter.chat(request);
    }
    /** 流式聊天补全,逐块回调。 */
    async chatStream(request, onChunk) {
        return this.#adapter.chatStream(request, onChunk);
    }
    /** 图片生成。 */
    generateImage(request) {
        if (this.#adapter.generateImage === undefined) {
            throw new LlmError("UNSUPPORTED", `Provider "${this.#adapter.name}" does not support image generation`, {
                provider: this.#adapter.name,
            });
        }
        return this.#adapter.generateImage(request);
    }
    /** 图片编辑。 */
    generateImageEdit(request) {
        if (this.#adapter.generateImageEdit === undefined) {
            throw new LlmError("UNSUPPORTED", `Provider "${this.#adapter.name}" does not support image editing`, {
                provider: this.#adapter.name,
            });
        }
        return this.#adapter.generateImageEdit(request);
    }
    /** 图片变体。 */
    generateImageVariation(request) {
        if (this.#adapter.generateImageVariation === undefined) {
            throw new LlmError("UNSUPPORTED", `Provider "${this.#adapter.name}" does not support image variation`, {
                provider: this.#adapter.name,
            });
        }
        return this.#adapter.generateImageVariation(request);
    }
}
/** 便捷工厂。 */
function createLlmClient(options) {
    return new LLMClient(options);
}

/** 简易超时信号。 */
function withTimeout(promise, timeoutMs, what) {
    if (timeoutMs <= 0) {
        return promise;
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${what} timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
/** 发送 JSON 请求并返回解析后的 body。非 2xx 抛 LlmError。 */
async function jsonRequest(provider, url, init) {
    const { timeoutMs, ...requestInit } = init;
    const response = await withTimeout(fetch(url, {
        method: requestInit.method ?? "POST",
        headers: requestInit.headers,
        ...(requestInit.body !== undefined
            ? { body: typeof requestInit.body === "string" ? requestInit.body : JSON.stringify(requestInit.body) }
            : {}),
    }), timeoutMs, `${provider} request`);
    const text = await withTimeout(response.text(), timeoutMs, `${provider} response body`);
    let body = null;
    if (text !== "") {
        try {
            body = JSON.parse(text);
        }
        catch {
            body = text;
        }
    }
    if (!response.ok) {
        const message = extractErrorMessage(body, `HTTP ${response.status}`);
        throw toLlmError({ status: response.status, message }, provider);
    }
    return body;
}

function toOpenAIRequest(request) {
    return {
        model: request.model,
        messages: request.messages,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
        ...(request.stream === true ? { stream: true } : {}),
        ...(request.tools !== undefined ? { tools: request.tools } : {}),
        ...(request.toolChoice !== undefined ? { tool_choice: request.toolChoice } : {}),
        ...(request.extra !== undefined ? request.extra : {}),
    };
}
function normalizeUsage(usage) {
    if (typeof usage !== "object" || usage === null) {
        return undefined;
    }
    const record = usage;
    const promptTokens = Number(record.prompt_tokens ?? record.input_tokens);
    const completionTokens = Number(record.completion_tokens ?? record.output_tokens);
    const explicitTotal = Number(record.total_tokens);
    return {
        promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
        completionTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
        totalTokens: Number.isFinite(explicitTotal)
            ? explicitTotal
            : Number.isFinite(promptTokens) && Number.isFinite(completionTokens)
                ? promptTokens + completionTokens
                : 0,
    };
}
function normalizeChatResponse$2(raw, provider, request) {
    const record = (typeof raw === "object" && raw !== null ? raw : {});
    const id = typeof record.id === "string" ? record.id : "chatcmpl-unknown";
    const model = typeof record.model === "string" ? record.model : request.model;
    const choicesRaw = Array.isArray(record.choices) ? record.choices : [];
    const choices = choicesRaw.map((choice, index) => {
        const choiceRecord = (typeof choice === "object" && choice !== null ? choice : {});
        const message = (typeof choiceRecord.message === "object" && choiceRecord.message !== null
            ? choiceRecord.message
            : {});
        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : undefined;
        const content = typeof message.content === "string" ? message.content : null;
        const normalizedMessage = { role: "assistant" };
        if (content !== null) {
            normalizedMessage.content = content;
        }
        if (toolCalls !== undefined) {
            normalizedMessage.tool_calls = toolCalls;
        }
        return {
            index,
            message: normalizedMessage,
            finishReason: typeof choiceRecord.finish_reason === "string" ? choiceRecord.finish_reason : null,
        };
    });
    const usage = normalizeUsage(record.usage);
    return {
        id,
        model,
        choices,
        ...(usage !== undefined ? { usage } : {}),
        provider,
        raw,
    };
}
/** OpenAI(及 OpenAI 兼容端点)适配器。 */
function openaiAdapter(config) {
    const baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/u, "");
    const path = config.path ?? "/chat/completions";
    const query = config.query;
    const url = `${baseUrl}${path}${query ? `?${new URLSearchParams(query).toString()}` : ""}`;
    const timeoutMs = config.timeoutMs ?? 60_000;
    function requestHeaders() {
        const headers = {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            ...(config.headers ?? {}),
        };
        return headers;
    }
    async function chat(request) {
        const body = await jsonRequest("openai", url, {
            headers: requestHeaders(),
            body: toOpenAIRequest({ ...request, stream: false }),
            timeoutMs,
        });
        return normalizeChatResponse$2(body, "openai", request);
    }
    async function chatStream(request, onChunk) {
        const response = await withTimeoutFetch$2(url, requestHeaders(), toOpenAIRequest({ ...request, stream: true }), timeoutMs);
        const reader = response.body?.getReader();
        if (reader === undefined) {
            throw new LlmError("UNKNOWN", "OpenAI stream returned no body", { provider: "openai" });
        }
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        let streamId = `chatcmpl-${Date.now()}`;
        const toolCalls = [];
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
                if (payload === "[DONE]") {
                    continue;
                }
                let event;
                try {
                    event = JSON.parse(payload);
                }
                catch {
                    continue;
                }
                const chunk = normalizeStreamChunk(event, "openai", request.model);
                if (chunk !== null) {
                    // 用提供商返回的真实 id(首个 chunk 即有)。
                    streamId = chunk.id;
                    // 累积流式内容用于最终响应。
                    for (const choice of chunk.choices) {
                        if (typeof choice.delta.content === "string") {
                            fullText += choice.delta.content;
                        }
                        if (Array.isArray(choice.delta.tool_calls)) {
                            for (const tc of choice.delta.tool_calls) {
                                const existing = toolCalls[tc.index];
                                if (existing === undefined) {
                                    const entry = {
                                        index: tc.index,
                                        ...(tc.id !== undefined ? { id: tc.id } : {}),
                                        ...(tc.type !== undefined ? { type: tc.type } : {}),
                                        ...(tc.function !== undefined
                                            ? {
                                                function: {
                                                    ...(tc.function.name !== undefined ? { name: tc.function.name } : {}),
                                                    ...(tc.function.arguments !== undefined
                                                        ? { arguments: tc.function.arguments }
                                                        : {}),
                                                },
                                            }
                                            : {}),
                                    };
                                    toolCalls[tc.index] = entry;
                                }
                                else {
                                    if (tc.id !== undefined) {
                                        existing.id = tc.id;
                                    }
                                    if (tc.type !== undefined) {
                                        existing.type = tc.type;
                                    }
                                    if (tc.function?.name !== undefined) {
                                        existing.function = { ...existing.function, name: tc.function.name };
                                    }
                                    if (tc.function?.arguments !== undefined) {
                                        existing.function = {
                                            ...existing.function,
                                            arguments: (existing.function?.arguments ?? "") + tc.function.arguments,
                                        };
                                    }
                                }
                            }
                        }
                    }
                    onChunk(chunk);
                }
            }
        }
        const finalToolCalls = toolCalls
            .filter((tc) => tc.id !== undefined)
            .map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
                name: tc.function?.name ?? "",
                arguments: tc.function?.arguments ?? "",
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
            provider: "openai",
            raw: undefined,
        };
    }
    function normalizeImageResponse(body) {
        const record = (typeof body === "object" && body !== null ? body : {});
        const data = Array.isArray(record.data) ? record.data : [];
        const images = data.map((item) => {
            const entry = (typeof item === "object" && item !== null ? item : {});
            const result = {};
            if (typeof entry.b64_json === "string") {
                result.b64Json = entry.b64_json;
            }
            if (typeof entry.url === "string") {
                result.url = entry.url;
            }
            if (typeof entry.revised_prompt === "string") {
                result.revisedPrompt = entry.revised_prompt;
            }
            return result;
        });
        return { images, provider: "openai", raw: body };
    }
    async function generateImage(request) {
        const body = await jsonRequest("openai", `${baseUrl}/images/generations`, {
            headers: requestHeaders(),
            body: {
                ...(request.model !== undefined ? { model: request.model } : {}),
                prompt: request.prompt,
                ...(request.size !== undefined ? { size: request.size } : {}),
                ...(request.n !== undefined ? { n: request.n } : {}),
                ...(request.responseFormat !== undefined
                    ? { response_format: request.responseFormat }
                    : { response_format: "b64_json" }),
                ...(request.quality !== undefined ? { quality: request.quality } : {}),
                ...(request.style !== undefined ? { style: request.style } : {}),
            },
            timeoutMs,
        });
        return normalizeImageResponse(body);
    }
    /** 把 data URL 或 base64 转成上传需要的二进制。 */
    function imageToBlob(image) {
        const match = /^data:([^;]+);base64,(.+)$/su.exec(image);
        if (match) {
            const mimeType = match[1] ?? "image/png";
            const base64 = match[2] ?? "";
            const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
            const buffer = Buffer.from(base64, "base64");
            return { filename: `image.${ext}`, blob: new Blob([buffer], { type: mimeType }) };
        }
        // 纯 base64,按 PNG 处理
        const buffer = Buffer.from(image, "base64");
        return { filename: "image.png", blob: new Blob([buffer], { type: "image/png" }) };
    }
    async function generateImageEdit(request) {
        const form = new FormData();
        const image = imageToBlob(request.image);
        form.append("image", image.blob, image.filename);
        if (request.mask !== undefined) {
            const mask = imageToBlob(request.mask);
            form.append("mask", mask.blob, mask.filename);
        }
        form.append("prompt", request.prompt);
        if (request.model !== undefined) {
            form.append("model", request.model);
        }
        if (request.size !== undefined) {
            form.append("size", request.size);
        }
        if (request.n !== undefined) {
            form.append("n", String(request.n));
        }
        form.append("response_format", request.responseFormat ?? "b64_json");
        const response = await withTimeoutFetchMultipart(`${baseUrl}/images/edits`, requestHeaders(), form, timeoutMs);
        const text = await withTimeout(response.text(), timeoutMs, "openai image edit response");
        const body = parseBody(text);
        if (!response.ok) {
            throw new LlmError(mapHttpStatus(response.status), extractErrorMessage(body, `HTTP ${response.status}`), {
                status: response.status,
                provider: "openai",
                cause: body,
            });
        }
        return normalizeImageResponse(body);
    }
    async function generateImageVariation(request) {
        const form = new FormData();
        const image = imageToBlob(request.image);
        form.append("image", image.blob, image.filename);
        if (request.model !== undefined) {
            form.append("model", request.model);
        }
        if (request.size !== undefined) {
            form.append("size", request.size);
        }
        if (request.n !== undefined) {
            form.append("n", String(request.n));
        }
        form.append("response_format", request.responseFormat ?? "b64_json");
        const response = await withTimeoutFetchMultipart(`${baseUrl}/images/variations`, requestHeaders(), form, timeoutMs);
        const text = await withTimeout(response.text(), timeoutMs, "openai image variation response");
        const body = parseBody(text);
        if (!response.ok) {
            throw new LlmError(mapHttpStatus(response.status), extractErrorMessage(body, `HTTP ${response.status}`), {
                status: response.status,
                provider: "openai",
                cause: body,
            });
        }
        return normalizeImageResponse(body);
    }
    return { name: "openai", chat, chatStream, generateImage, generateImageEdit, generateImageVariation };
}
function parseBody(text) {
    if (text === "") {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
/** 带超时的 multipart fetch。 */
async function withTimeoutFetchMultipart(url, headers, form, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const requestHeaders = { ...headers };
    delete requestHeaders["content-type"]; // FormData 自带 boundary
    try {
        return await fetch(url, {
            method: "POST",
            headers: requestHeaders,
            body: form,
            signal: controller.signal,
        });
    }
    catch (error) {
        if (controller.signal.aborted) {
            throw new LlmError("TIMEOUT", `openai request timed out after ${timeoutMs} ms`, {
                cause: error,
                provider: "openai",
            });
        }
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
function normalizeStreamChunk(event, provider, model) {
    if (event.id === undefined || !Array.isArray(event.choices)) {
        return null;
    }
    const choices = event.choices.map((choice, index) => {
        const choiceRecord = (typeof choice === "object" && choice !== null ? choice : {});
        const delta = (typeof choiceRecord.delta === "object" && choiceRecord.delta !== null
            ? choiceRecord.delta
            : {});
        return {
            index,
            delta: {
                ...(typeof delta.role === "string" ? { role: delta.role } : {}),
                ...(typeof delta.content === "string" ? { content: delta.content } : {}),
                ...(Array.isArray(delta.tool_calls) ? { tool_calls: delta.tool_calls } : {}),
            },
            finishReason: typeof choiceRecord.finish_reason === "string" ? choiceRecord.finish_reason : null,
        };
    });
    return {
        id: String(event.id),
        model: typeof event.model === "string" ? event.model : model,
        choices,
        provider,
        raw: event,
    };
}
/** 带超时的 fetch。 */
async function withTimeoutFetch$2(url, headers, body, timeoutMs) {
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
            throw new LlmError("TIMEOUT", `openai request timed out after ${timeoutMs} ms`, {
                cause: error,
                provider: "openai",
            });
        }
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}

/**
 * Azure OpenAI 适配器。
 * Azure 的请求体与 OpenAI 基本一致,差别在 endpoint(部署名 + api-version 查询参数)
 * 与认证(api-key 头)。通过 openaiAdapter 的 path/query 覆盖即可复用全部逻辑。
 */
function azureAdapter(config) {
    const baseUrl = config.baseUrl.replace(/\/+$/u, "");
    const apiVersion = config.apiVersion ?? "2024-06-01";
    // Azure 的 URL 是 .../openai/deployments/{deployment}/chat/completions?api-version=...
    // 认证用 api-key 头而不是 Bearer,通过 headers 覆盖。
    const inner = openaiAdapter({
        apiKey: config.apiKey,
        baseUrl,
        path: `/openai/deployments/${config.deployment}/chat/completions`,
        query: { "api-version": apiVersion },
        headers: { "api-key": config.apiKey },
        ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    });
    return {
        name: "azure",
        async chat(request) {
            const result = await inner.chat(request);
            return { ...result, provider: "azure" };
        },
        async chatStream(request, onChunk) {
            const result = await inner.chatStream(request, (chunk) => onChunk({ ...chunk, provider: "azure" }));
            return { ...result, provider: "azure" };
        },
    };
}

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
                    input: safeParseJson$1(call.function.arguments),
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
                        media_type: guessMediaType$1(url),
                        data: extractBase64$1(url),
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
function guessMediaType$1(url) {
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
function extractBase64$1(url) {
    const match = /^data:[^;]+;base64,(.+)$/su.exec(url);
    return match ? (match[1] ?? "") : url;
}
function safeParseJson$1(value) {
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
function normalizeChatResponse$1(raw, request) {
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
function anthropicAdapter(config) {
    const baseUrl = (config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/+$/u, "");
    const timeoutMs = config.timeoutMs ?? 60_000;
    async function chat(request) {
        const response = await rawRequest$1(`${baseUrl}/messages`, { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }, toAnthropicRequest({ ...request, stream: false }), timeoutMs);
        return normalizeChatResponse$1(response, request);
    }
    async function chatStream(request, onChunk) {
        const response = await withTimeoutFetch$1(`${baseUrl}/messages`, {
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
                    else ;
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
async function rawRequest$1(url, headers, body, timeoutMs) {
    const response = await withTimeoutFetch$1(url, headers, body, timeoutMs);
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
        throw new LlmError(mapHttpStatus(response.status), message, {
            status: response.status,
            provider: "anthropic",
            cause: parsed,
        });
    }
    return parsed;
}
async function withTimeoutFetch$1(url, headers, body, timeoutMs) {
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

/**
 * Google Gemini 适配器。
 * 将 OpenAI 形态请求转换为 Gemini generateContent REST 格式,
 * 响应归一为 OpenAI 形态。
 */
function toGeminiContent(message) {
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
function mapRole(role) {
    if (role === "assistant") {
        return "model";
    }
    if (role === "tool") {
        return "function";
    }
    return "user";
}
function guessMediaType(url) {
    const match = /^data:([^;]+);base64,/u.exec(url);
    if (match) {
        return match[1] ?? "image/png";
    }
    return "image/png";
}
function extractBase64(url) {
    const match = /^data:[^;]+;base64,(.+)$/su.exec(url);
    return match ? (match[1] ?? "") : url;
}
function toGeminiContents(messages) {
    const result = [];
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
            const parts = [];
            if (typeof message.content === "string" && message.content !== "") {
                parts.push({ text: message.content });
            }
            for (const call of message.tool_calls) {
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
function safeParseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return {};
    }
}
function toGeminiTool(tool) {
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
function toGeminiRequest(request) {
    const body = {
        contents: toGeminiContents(request.messages),
    };
    const generationConfig = {};
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
function normalizeChatResponse(raw, request) {
    const record = (typeof raw === "object" && raw !== null ? raw : {});
    const candidates = Array.isArray(record.candidates) ? record.candidates : [];
    const first = (typeof candidates[0] === "object" && candidates[0] !== null
        ? candidates[0]
        : {});
    const content = (typeof first.content === "object" && first.content !== null
        ? first.content
        : {});
    const parts = Array.isArray(content.parts) ? content.parts : [];
    let text = "";
    const toolCalls = [];
    for (const part of parts) {
        const partRecord = (typeof part === "object" && part !== null ? part : {});
        if (typeof partRecord.text === "string") {
            text += partRecord.text;
        }
        if (typeof partRecord.functionCall === "object" && partRecord.functionCall !== null) {
            const fc = partRecord.functionCall;
            toolCalls.push({
                id: `call_${toolCalls.length}`,
                name: String(fc.name ?? ""),
                args: (typeof fc.args === "object" && fc.args !== null ? fc.args : {}),
            });
        }
    }
    const finishReason = String(first.finishReason ?? "");
    const usageRaw = (typeof record.usageMetadata === "object" && record.usageMetadata !== null
        ? record.usageMetadata
        : {});
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
                                type: "function",
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
            totalTokens: Number(usageRaw.promptTokenCount ?? 0) +
                Number(usageRaw.candidatesTokenCount ?? 0),
        },
        provider: "gemini",
        raw,
    };
}
function mapFinishReason(reason) {
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
function geminiAdapter(config) {
    const baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/u, "");
    const timeoutMs = config.timeoutMs ?? 60_000;
    function urlFor(model, stream) {
        const action = stream ? "streamGenerateContent" : "generateContent";
        return `${baseUrl}/models/${model}:${action}?alt=sse&key=${config.apiKey}`;
    }
    async function chat(request) {
        const response = await rawRequest(urlFor(request.model, false), toGeminiRequest(request), timeoutMs);
        return normalizeChatResponse(response, request);
    }
    async function chatStream(request, onChunk) {
        const response = await withTimeoutFetch(urlFor(request.model, true), toGeminiRequest(request), timeoutMs);
        const reader = response.body?.getReader();
        if (reader === undefined) {
            throw new LlmError("UNKNOWN", "Gemini stream returned no body", { provider: "gemini" });
        }
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        let streamId = `gemini-${Date.now()}`;
        const streamedToolCalls = [];
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
                let event;
                try {
                    event = JSON.parse(payload);
                }
                catch {
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
                    }
                    else {
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
            type: "function",
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
async function rawRequest(url, body, timeoutMs) {
    const response = await withTimeoutFetch(url, body, timeoutMs);
    const text = await withTimeout(response.text(), timeoutMs, "gemini response body");
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
        throw new LlmError(mapHttpStatus(response.status), message, {
            status: response.status,
            provider: "gemini",
            cause: parsed,
        });
    }
    return parsed;
}
async function withTimeoutFetch(url, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    }
    catch (error) {
        if (controller.signal.aborted) {
            throw new LlmError("TIMEOUT", `gemini request timed out after ${timeoutMs} ms`, {
                cause: error,
                provider: "gemini",
            });
        }
        throw toLlmError(error, "gemini");
    }
    finally {
        clearTimeout(timer);
    }
}

/** 轻量 OpenAI 兼容代理:暴露 /v1/chat/completions,内部用 LLMClient 路由。 */
function createLlmProxy(options) {
    const client = new LLMClient({ adapter: options.adapter });
    return node_http.createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/v1/models") {
            writeJson(response, 200, { object: "list", data: [] });
            return;
        }
        if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
            try {
                const body = await readJson(request);
                const chatRequest = normalizeRequest(body, options.defaultModel);
                if (chatRequest.stream === true) {
                    await handleStream(response, client, chatRequest);
                }
                else {
                    const result = await client.chat(chatRequest);
                    writeJson(response, 200, toWireResponse(result));
                }
            }
            catch (error) {
                writeError(response, error);
            }
            return;
        }
        if (request.method === "POST" && url.pathname === "/v1/images/generations") {
            try {
                const body = await readJson(request);
                const result = await client.generateImage({
                    ...(typeof body.model === "string" ? { model: body.model } : {}),
                    prompt: typeof body.prompt === "string" ? body.prompt : "",
                    ...(typeof body.size === "string" ? { size: body.size } : {}),
                    ...(typeof body.n === "number" ? { n: body.n } : {}),
                    ...(typeof body.response_format === "string"
                        ? { responseFormat: body.response_format }
                        : {}),
                });
                writeJson(response, 200, {
                    created: Math.floor(Date.now() / 1000),
                    data: result.images.map((image) => ({
                        ...(image.b64Json !== undefined ? { b64_json: image.b64Json } : {}),
                        ...(image.url !== undefined ? { url: image.url } : {}),
                        ...(image.revisedPrompt !== undefined ? { revised_prompt: image.revisedPrompt } : {}),
                    })),
                });
            }
            catch (error) {
                writeError(response, error);
            }
            return;
        }
        writeJson(response, 404, { error: { message: "Not found", type: "not_found" } });
    });
}
function normalizeRequest(body, defaultModel) {
    if (typeof body.messages === "undefined" || !Array.isArray(body.messages)) {
        throw new LlmError("INVALID_REQUEST", "messages is required and must be an array");
    }
    const model = typeof body.model === "string" ? body.model : defaultModel;
    if (model === undefined) {
        throw new LlmError("INVALID_REQUEST", "model is required");
    }
    const result = {
        model,
        messages: body.messages,
    };
    if (typeof body.temperature === "number") {
        result.temperature = body.temperature;
    }
    if (typeof body.max_tokens === "number") {
        result.maxTokens = body.max_tokens;
    }
    if (typeof body.maxTokens === "number") {
        result.maxTokens = body.maxTokens;
    }
    if (body.stream === true) {
        result.stream = true;
    }
    if (Array.isArray(body.tools)) {
        result.tools = body.tools;
    }
    if (body.tool_choice !== undefined) {
        result.toolChoice = body.tool_choice;
    }
    return result;
}
/** 把统一响应转成 OpenAI 线上格式。 */
function toWireResponse(result) {
    return {
        id: result.id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: result.model,
        choices: result.choices.map((choice) => ({
            index: choice.index,
            message: choice.message,
            finish_reason: choice.finishReason,
        })),
        usage: result.usage
            ? {
                prompt_tokens: result.usage.promptTokens,
                completion_tokens: result.usage.completionTokens,
                total_tokens: result.usage.totalTokens,
            }
            : undefined,
    };
}
async function handleStream(response, client, request) {
    response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
    });
    await client.chatStream(request, (chunk) => {
        chunk.id;
        const wire = {
            id: chunk.id,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: chunk.model,
            choices: chunk.choices.map((choice) => ({
                index: choice.index,
                delta: choice.delta,
                finish_reason: choice.finishReason,
            })),
        };
        response.write(`data: ${JSON.stringify(wire)}\n\n`);
    });
    response.write(`data: [DONE]\n\n`);
    response.end();
}
async function readJson(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString("utf8");
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("not an object");
        }
        return parsed;
    }
    catch {
        throw new LlmError("INVALID_REQUEST", "Request body must be valid JSON object");
    }
}
function writeJson(response, status, value) {
    response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
    });
    response.end(JSON.stringify(value));
}
function writeError(response, error) {
    const llmError = error instanceof LlmError ? error : new LlmError("UNKNOWN", String(error));
    writeJson(response, statusForCode(llmError.code), {
        error: {
            message: llmError.message,
            type: llmError.code,
            ...(llmError.status !== undefined ? { status: llmError.status } : {}),
        },
    });
}
function statusForCode(code) {
    switch (code) {
        case "INVALID_REQUEST":
            return 400;
        case "AUTHENTICATION":
            return 401;
        case "MODEL_NOT_FOUND":
            return 404;
        case "RATE_LIMIT":
            return 429;
        case "TIMEOUT":
            return 504;
        default:
            return 500;
    }
}

/** 内置的 OpenAI 兼容提供商注册表。 */
const openaiCompatibleProviders = [
    { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModels: ["gpt-4o", "gpt-4o-mini"] },
    { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModels: ["deepseek-v4-pro", "deepseek-v4-flash"] },
    { id: "moonshot", name: "Moonshot AI (Kimi)", baseUrl: "https://api.moonshot.cn/v1", defaultModels: ["moonshot-v1-8k", "moonshot-v1-32k"] },
    { id: "zhipu", name: "智谱 AI (BigModel)", baseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModels: ["glm-4-plus", "glm-4-flash"] },
    { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", defaultModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"] },
    { id: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", defaultModels: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"] },
    { id: "fireworks", name: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1", defaultModels: ["accounts/fireworks/models/llama-v3p1-70b-instruct"] },
    { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModels: ["openai/gpt-4o", "anthropic/claude-sonnet-4"] },
    { id: "perplexity", name: "Perplexity", baseUrl: "https://api.perplexity.ai", defaultModels: ["sonar-pro", "sonar"] },
    { id: "mistral", name: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", defaultModels: ["mistral-large-latest", "mistral-small-latest"] },
    { id: "aliyun", name: "阿里云百炼 (DashScope)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModels: ["qwen-plus", "qwen-turbo"] },
    { id: "ollama", name: "Ollama (本地)", baseUrl: "http://localhost:11434/v1", defaultModels: ["llama3.1", "qwen2.5"], note: "本地模型,默认 localhost" },
    { id: "vllm", name: "vLLM (自部署)", baseUrl: "http://localhost:8000/v1", defaultModels: [], note: "自部署 vLLM 服务器" },
    { id: "lmstudio", name: "LM Studio (本地)", baseUrl: "http://localhost:1234/v1", defaultModels: [], note: "本地模型,默认 localhost" },
];
const registryMap = new Map(openaiCompatibleProviders.map((entry) => [entry.id, entry]));
/** 列出所有已注册的提供商 id。 */
function listProviders() {
    return [...registryMap.keys()];
}
/** 获取提供商注册项,未注册抛 LlmError。 */
function getProviderEntry(id) {
    const entry = registryMap.get(id);
    if (entry === undefined) {
        throw new LlmError("CONFIGURATION", `Unknown provider "${id}". Known providers: ${listProviders().join(", ")}`);
    }
    return entry;
}
/**
 * 注册自定义提供商(运行时扩展)。
 * 若 id 已存在则覆盖内置项,调用方需自行确认覆盖意图。
 */
function registerProvider(entry) {
    registryMap.set(entry.id, entry);
}
/** 按提供商 id 创建适配器,返回 OpenAI 兼容适配器。 */
function createProviderAdapter(id, apiKey, options) {
    const entry = getProviderEntry(id);
    const config = {
        apiKey,
        baseUrl: options?.baseUrl ?? entry.baseUrl,
        ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    };
    if (entry.auth !== undefined && entry.auth !== "bearer") {
        const custom = entry.auth;
        config.headers = { [custom.header]: custom.value(apiKey) };
    }
    return openaiAdapter(config);
}

exports.LLMClient = LLMClient;
exports.LlmError = LlmError;
exports.anthropicAdapter = anthropicAdapter;
exports.azureAdapter = azureAdapter;
exports.createLlmClient = createLlmClient;
exports.createLlmProxy = createLlmProxy;
exports.createProviderAdapter = createProviderAdapter;
exports.extractErrorMessage = extractErrorMessage;
exports.geminiAdapter = geminiAdapter;
exports.getProviderEntry = getProviderEntry;
exports.listProviders = listProviders;
exports.mapHttpStatus = mapHttpStatus;
exports.openaiAdapter = openaiAdapter;
exports.openaiCompatibleProviders = openaiCompatibleProviders;
exports.registerProvider = registerProvider;
exports.toLlmError = toLlmError;
