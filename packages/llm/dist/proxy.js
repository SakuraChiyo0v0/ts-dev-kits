import { createServer } from "node:http";
import { LLMClient } from "./client.js";
import { LlmError } from "./errors.js";
/** 轻量 OpenAI 兼容代理:暴露 /v1/chat/completions,内部用 LLMClient 路由。 */
export function createLlmProxy(options) {
    const client = new LLMClient({ adapter: options.adapter });
    return createServer(async (request, response) => {
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
    let id = `chatcmpl-${Date.now()}`;
    await client.chatStream(request, (chunk) => {
        id = chunk.id;
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
