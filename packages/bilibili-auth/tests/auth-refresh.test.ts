import { describe, expect, it } from "vitest";
import { refreshCookies } from "../src/index.js";

/** 构造带多条 set-cookie 的 Response。 */
function responseWithCookies(
  body: unknown,
  cookies: string[],
  status = 200,
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

describe("refreshCookies", () => {
  it("成功续期:合并新 cookie 并更新 refresh_token", async () => {
    const fetchImpl = async () =>
      responseWithCookies(
        { code: 0, data: { status: true, message: "", refresh_token: "new-token" } },
        [
          "SESSDATA=new-sess; path=/; Max-Age=7776000",
          "bili_jct=new-jct; path=/",
          "DedeUserID=123; path=/",
        ],
      );
    const result = await refreshCookies(
      {
        cookies: "SESSDATA=old; bili_jct=old-jct; DedeUserID=123",
        refreshToken: "old-token",
        savedAt: new Date().toISOString(),
      },
      fetchImpl,
    );
    expect(result.cookies).toContain("SESSDATA=new-sess");
    expect(result.cookies).toContain("bili_jct=new-jct");
    expect(result.cookies).toContain("DedeUserID=123");
    expect(result.refreshToken).toBe("new-token");
  });

  it("refresh_token 失效抛 AUTH_EXPIRED", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ code: -101, message: "登录已过期" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await expect(
      refreshCookies(
        {
          cookies: "SESSDATA=old; bili_jct=old-jct",
          refreshToken: "dead",
          savedAt: new Date().toISOString(),
        },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
  });

  it("缺少 bili_jct 无法续期", async () => {
    await expect(
      refreshCookies(
        { cookies: "SESSDATA=only", refreshToken: "t", savedAt: new Date().toISOString() },
        async () => new Response("{}"),
      ),
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
  });

  it("网络错误归一为 NETWORK", async () => {
    await expect(
      refreshCookies(
        { cookies: "SESSDATA=a; bili_jct=b", refreshToken: "t", savedAt: new Date().toISOString() },
        async () => {
          throw new Error("fetch failed");
        },
      ),
    ).rejects.toMatchObject({ code: "NETWORK" });
  });
});
