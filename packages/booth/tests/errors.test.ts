import { describe, expect, it } from "vitest";
import {
  BoothError,
  toBoothError,
  checkApiResponse,
  isBoothError,
  isBoothErrorCode,
  isFreeItem,
} from "../src/errors.js";
import type { BoothItem } from "../src/types.js";

describe("BoothError", () => {
  it("构造错误并保留 code", () => {
    const error = new BoothError("NOT_FOUND", "item not found", { itemId: "123" });
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("item not found");
    expect(error.context).toEqual({ itemId: "123" });
    expect(isBoothError(error)).toBe(true);
  });

  it("isBoothErrorCode 校验枚举", () => {
    expect(isBoothErrorCode("NETWORK")).toBe(true);
    expect(isBoothErrorCode("PAYMENT_REQUIRED")).toBe(true);
    expect(isBoothErrorCode("BOGUS")).toBe(false);
  });
});

describe("toBoothError", () => {
  it("BoothError 原样返回", () => {
    const original = new BoothError("AUTH_EXPIRED", "session expired");
    expect(toBoothError(original)).toBe(original);
  });

  it("网络类错误归类为 NETWORK", () => {
    const network = toBoothError(new TypeError("fetch failed: ECONNREFUSED"));
    expect(network.code).toBe("NETWORK");
  });

  it("普通错误归类为 UNKNOWN", () => {
    const unknown = toBoothError(new Error("boom"));
    expect(unknown.code).toBe("UNKNOWN");
  });

  it("非 Error 值也归类", () => {
    const unknown = toBoothError("string error");
    expect(unknown.code).toBe("UNKNOWN");
  });
});

describe("checkApiResponse", () => {
  function fakeResponse(status: number): Response {
    return new Response(null, { status });
  }

  it("2xx 通过", () => {
    expect(() => checkApiResponse(fakeResponse(200))).not.toThrow();
  });

  it("404 → NOT_FOUND", () => {
    expect(() => checkApiResponse(fakeResponse(404))).toThrowError(BoothError);
    try {
      checkApiResponse(fakeResponse(404));
    } catch (error) {
      expect((error as BoothError).code).toBe("NOT_FOUND");
    }
  });

  it("401/403 → LOGIN_REQUIRED", () => {
    for (const status of [401, 403]) {
      try {
        checkApiResponse(fakeResponse(status));
        throw new Error("should have thrown");
      } catch (error) {
        expect((error as BoothError).code).toBe("LOGIN_REQUIRED");
      }
    }
  });

  it("其它状态 → API_ERROR", () => {
    try {
      checkApiResponse(fakeResponse(500));
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as BoothError).code).toBe("API_ERROR");
    }
  });
});

describe("isFreeItem", () => {
  const base: BoothItem = {
    id: "1",
    title: "t",
    priceYen: 0,
    shopId: "s",
    alreadyOwned: false,
    csrfToken: "c",
  };

  it("0 日元视为免费", () => {
    expect(isFreeItem(base)).toBe(true);
  });

  it("非 0 日元视为付费", () => {
    expect(isFreeItem({ ...base, priceYen: 500 })).toBe(false);
  });
});
