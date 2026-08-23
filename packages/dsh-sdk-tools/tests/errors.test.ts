import { describe, expect, it } from "vitest";
import { describeError } from "../src/errors.js";

/** 构造一个带 code 的假 SDK 错误。 */
function sdkError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

describe("describeError", () => {
  it("maps known SDK error codes to readable messages", () => {
    expect(describeError(sdkError("LOGIN_REQUIRED", "cookie missing"))).toBe(
      "需要登录:请先完成扫码登录后再试",
    );
    expect(describeError(sdkError("PRIVILEGE_DENIED", "no permission"))).toBe(
      "当前账号无权请求该品质,已拒绝(不降级)",
    );
    expect(describeError(sdkError("TRIAL_ONLY", "trial detected"))).toBe(
      "返回的是试听片段,已拒绝下载不完整音频",
    );
    expect(describeError(sdkError("CLIENT_NOT_RUNNING", "no client"))).toBe(
      "英雄联盟客户端未运行,请先启动游戏客户端",
    );
    expect(describeError(sdkError("DISK_FULL", "ENOSPC"))).toBe(
      "磁盘空间不足,请清理磁盘空间后重试(ENOSPC)",
    );
    // INVALID_URL 是多平台共用码(netease / bilibili),文案不得绑定单一平台。
    const invalidUrlMessage = describeError(sdkError("INVALID_URL", "bad link"));
    expect(invalidUrlMessage).toContain("无法解析该链接");
    expect(invalidUrlMessage).not.toContain("B 站链接");
    expect(invalidUrlMessage).toContain("B 站");
    expect(invalidUrlMessage).toContain("网易云");
  });

  it("appends SDK detail for diagnostic codes (download/network/disk)", () => {
    // DOWNLOAD_FAILED / NETWORK / DISK_FULL 附带底层原因,便于区分根因。
    expect(describeError(sdkError("DOWNLOAD_FAILED", "HTTP 403"))).toBe(
      "下载失败,请检查网络或磁盘空间后重试(HTTP 403)",
    );
    expect(describeError(sdkError("NETWORK", "fetch failed"))).toBe(
      "网络请求失败,请检查网络连接后重试(fetch failed)",
    );
    expect(describeError(sdkError("DISK_FULL", "ENOSPC: no space left"))).toBe(
      "磁盘空间不足,请清理磁盘空间后重试(ENOSPC: no space left)",
    );
    // LOGIN_REQUIRED 不需要附加细节(文案已明确)。
    expect(describeError(sdkError("LOGIN_REQUIRED", "cookie missing"))).toBe(
      "需要登录:请先完成扫码登录后再试",
    );
  });

  it("falls back to the SDK message with code for unknown codes", () => {
    expect(describeError(sdkError("SOME_NEW_CODE", "weird thing"))).toBe(
      "weird thing (SOME_NEW_CODE)",
    );
  });

  it("falls back to Error.message for plain errors", () => {
    expect(describeError(new Error("plain failure"))).toBe("plain failure");
  });

  it("stringifies non-Error throws", () => {
    expect(describeError("boom")).toBe("boom");
  });
});
