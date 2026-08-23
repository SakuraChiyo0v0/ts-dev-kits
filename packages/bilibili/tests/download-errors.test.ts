import { describe, expect, it } from "vitest";
import { BilibiliError } from "../src/errors.js";
import { classifyDownloadError } from "../src/download.js";

function err(message: string, name = "Error"): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe("classifyDownloadError", () => {
  it("classifies fetch network failures as NETWORK", () => {
    expect(classifyDownloadError(err("fetch failed", "TypeError"), 6).code).toBe("NETWORK");
    expect(classifyDownloadError(err("getaddrinfo ENOTFOUND api.bilibili.com"), 6).code).toBe(
      "NETWORK",
    );
  });

  it("classifies timeouts as NETWORK", () => {
    expect(classifyDownloadError(err("timed out", "TimeoutError"), 6).code).toBe("NETWORK");
    expect(classifyDownloadError(err("aborted", "AbortError"), 6).code).toBe("NETWORK");
  });

  it("classifies disk-full as DISK_FULL", () => {
    expect(classifyDownloadError(err("ENOSPC: no space left on device"), 6).code).toBe(
      "DISK_FULL",
    );
  });

  it("passes through BilibiliError with explicit code (e.g. 403 LOGIN_REQUIRED)", () => {
    const loginError = new BilibiliError("LOGIN_REQUIRED", "HTTP 403");
    expect(classifyDownloadError(loginError, 6)).toBe(loginError);
    expect(classifyDownloadError(loginError, 6).code).toBe("LOGIN_REQUIRED");
  });

  it("falls back to DOWNLOAD_FAILED for unknown errors", () => {
    expect(classifyDownloadError(err("something weird"), 6).code).toBe("DOWNLOAD_FAILED");
  });
});
