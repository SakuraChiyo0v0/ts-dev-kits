import { extractErrorMessage, toLlmError } from "./errors.js";
/** 简易超时信号。 */
export function withTimeout(promise, timeoutMs, what) {
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
export async function jsonRequest(provider, url, init) {
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
