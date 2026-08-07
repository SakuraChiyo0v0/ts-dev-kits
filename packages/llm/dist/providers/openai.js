import { LlmError, extractErrorMessage, mapHttpStatus } from "../errors.js";
import { jsonRequest, withTimeout } from "../http.js";
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
function normalizeChatResponse(raw, provider, request) {
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
export function openaiAdapter(config) {
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
        return normalizeChatResponse(body, "openai", request);
    }
    async function chatStream(request, onChunk) {
        const response = await withTimeoutFetch(url, requestHeaders(), toOpenAIRequest({ ...request, stream: true }), timeoutMs);
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
            throw new LlmError(mapHttpStatus(response.status, "openai"), extractErrorMessage(body, `HTTP ${response.status}`), {
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
            throw new LlmError(mapHttpStatus(response.status, "openai"), extractErrorMessage(body, `HTTP ${response.status}`), {
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
