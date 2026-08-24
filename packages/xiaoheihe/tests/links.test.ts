/**
 * 查询域测试 —— mock 服务器真实协议路径。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createXiaoheiheClient } from "../src/client.js";
import { XiaoheiheError } from "../src/errors.js";
import { startMockServer } from "./helpers/mock-server.js";

let server: { baseUrl: string; close: () => Promise<void> };
let baseUrl: string;

beforeAll(async () => {
  server = await startMockServer();
  baseUrl = server.baseUrl;
});

afterAll(async () => {
  await server.close();
});

describe("links 查询域", () => {
  it("getDetail 解析帖子详情(标题/正文二次解析/评论/翻页信息)", async () => {
    const client = createXiaoheiheClient({ baseUrl });
    const detail = await client.links.getDetail({ linkId: 3001 });
    expect(detail.linkId).toBe(3001);
    expect(detail.title).toBe("测试帖子");
    expect(detail.contents).toEqual([
      { text: "帖子正文段落一", type: "text" },
      { text: "https://img.example.com/a.png", type: "image", url: "https://img.example.com/a.png" },
    ]);
    expect(detail.comments).toHaveLength(1);
    expect(detail.comments[0]?.text).toBe("第一条评论");
    expect(detail.comments[0]?.user?.username).toBe("alice");
    expect(detail.totalPage).toBe(3);
    expect(detail.hasMoreFloors).toBe(true);
    expect(detail.author?.username).toBe("poster");
    expect(detail.topics).toEqual([{ name: "测试话题" }]);
  });

  it("getDetail 第二页可解析", async () => {
    const client = createXiaoheiheClient({ baseUrl });
    const detail = await client.links.getDetail({ linkId: 3001, page: 2 });
    expect(detail.comments).toHaveLength(1);
  });

  it("getSubComments 游标翻页", async () => {
    const client = createXiaoheiheClient({ baseUrl });
    const result = await client.links.getSubComments({ rootCommentId: 1001 });
    expect(result.has_more).toBe(false);
    expect(result.lastval).toBe(42);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]?.text).toBe("子评论一");
  });
});

describe("feeds 查询域", () => {
  it("list 返回首页帖子流(userid 字符串类型)", async () => {
    const client = createXiaoheiheClient({ baseUrl });
    const links = await client.feeds.list();
    expect(links).toHaveLength(1);
    expect(links[0]?.linkid).toBe(3001);
    expect(links[0]?.title).toBe("首页帖子一");
    expect(links[0]?.user?.userid).toBe("777");
  });
});

describe("messages 查询域", () => {
  it("listAt 返回 @消息", async () => {
    const client = createXiaoheiheClient({ baseUrl, cookie: "token_a=value_a" });
    const messages = await client.messages.listAt();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.comment_a_text).toBe("在吗?");
    expect(messages[0]?.user_a?.nickname).toBe("召唤者");
  });
});

describe("user 查询域", () => {
  it("getProfile 返回用户资料", async () => {
    const client = createXiaoheiheClient({ baseUrl, cookie: "token_a=value_a" });
    const profile = await client.user.getProfile(123);
    expect(profile?.username).toBe("poster");
    expect(profile?.nickname).toBe("发帖人");
  });
});

describe("auth 域", () => {
  it("未登录时 status 抛 LOGIN_REQUIRED", async () => {
    const client = createXiaoheiheClient({ baseUrl });
    await expect(client.auth.status()).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  });

  it("已登录时 status 通过(读取 @消息成功)", async () => {
    const client = createXiaoheiheClient({ baseUrl, cookie: "token_a=value_a" });
    const status = await client.auth.status();
    expect(status.loggedIn).toBe(true);
  });
});
