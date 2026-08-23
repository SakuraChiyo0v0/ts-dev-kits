import { describe, it, expect } from "vitest";
import { SteamError, toSteamError } from "../src/errors.js";

describe("SteamError", () => {
  it("基本构造与字段", () => {
    const error = new SteamError("RATE_LIMIT", "限流", { retryAfterSeconds: 5 });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SteamError");
    expect(error.code).toBe("RATE_LIMIT");
    expect(error.retryAfterSeconds).toBe(5);
    expect(error.statusCode).toBeUndefined();
  });

  it("可选字段不设置时为 undefined", () => {
    const error = new SteamError("NOT_FOUND", "x");
    expect(error.statusCode).toBeUndefined();
    expect(error.retryAfterSeconds).toBeUndefined();
  });
});

describe("toSteamError", () => {
  it("SteamError 原样返回", () => {
    const original = new SteamError("NETWORK", "x");
    expect(toSteamError(original, "ctx")).toBe(original);
  });

  it("网络类错误 → NETWORK", () => {
    expect(toSteamError(new Error("fetch failed"), "ctx").code).toBe("NETWORK");
    expect(toSteamError(new Error("getaddrinfo ENOTFOUND host"), "ctx").code).toBe("NETWORK");
    expect(toSteamError(new Error("connect ECONNREFUSED"), "ctx").code).toBe("NETWORK");
  });

  it("超时类错误 → TIMEOUT", () => {
    expect(toSteamError(new Error("request timeout"), "ctx").code).toBe("TIMEOUT");
    expect(toSteamError(new Error("connect ETIMEDOUT"), "ctx").code).toBe("TIMEOUT");
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(toSteamError(abort, "ctx").code).toBe("TIMEOUT");
  });

  it("其他错误 → UNKNOWN 且带上下文", () => {
    const error = toSteamError(new Error("boom"), "some context");
    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toContain("some context");
  });

  it("非 Error 输入 → UNKNOWN", () => {
    expect(toSteamError("oops", "ctx").code).toBe("UNKNOWN");
  });
});
