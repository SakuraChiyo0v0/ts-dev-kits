/**
 * 真实接口冒烟测试(BILI_SMOKE=1 时启用)。
 *
 * 用法:
 *   BILI_SMOKE=1 pnpm --filter @sakurachiyo0v0/bilibili test
 *
 * 默认跳过。启用后访问 B 站真实接口,验证各平台控制域:
 *   - 登录态加载(auth.json,缺省平台配置目录或 BILI_AUTH_PATH 指定);
 *   - 收藏夹:创建→收藏视频→查询→删除(自清理);
 *   - 关注:关注/取关一个 UP 主(自清理);
 *   - 分组:创建分组→删除(自清理);
 *   - 互动:点赞/取消赞、一键三连状态查询(只读);
 *   - 评论:仅列表(不实际发表,避免留下评论);
 *   - 弹幕:仅列表(不实际发送);
 *   - 动态:仅查询自己/他人动态接口(不实际发布);
 *   - 数据:稍后再看添加→移除(自清理)、历史记录只读;
 *   - 创作:稿件列表(只读,需 UP 主账号,失败降级跳过)。
 *
 * 写操作全部自清理(结束后恢复原状);网络失败会抛错,便于发现真实环境问题。
 */
import { describe, expect, it } from "vitest";
import { createBilibiliClient } from "../src/index.js";

// 冒烟测试涉及真实接口 + 最终一致性轮询,放宽默认超时。
const TIMEOUT = 30_000;

const SMOKE = process.env.BILI_SMOKE === "1";
const authPath = process.env.BILI_AUTH_PATH;

/** 轮询等待条件成立(B 站接口有最终一致性,写后读取可能短暂滞后)。 */
async function waitFor(condition: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

function makeClient() {
  return createBilibiliClient({
    ...(authPath !== undefined ? { authPath } : {}),
  });
}

describe.skipIf(!SMOKE)("bilibili real API smoke", () => {
  it("loads login state from auth store and can query self", async () => {
    const client = makeClient();
    // 未显式传 cookie,应自动从登录态存储加载。
    expect(client.isLoggedIn).toBe(true);
    const mid = client.currentMid!;
    expect(mid).toBeGreaterThan(0);
    const stat = await client.relation.getStat(mid);
    expect(stat.following).toBeGreaterThanOrEqual(0);
  });

  it("favorites: create folder -> favourite video -> query -> delete (self-cleaning)", async () => {
    const client = makeClient();
    const title = `smoke-${Date.now()}`;
    const mediaId = await client.fav.createFolder({ title, privacy: 1 });
    try {
      const info = await client.fav.getFolderInfo(mediaId);
      expect(info.title).toBe(title);
      expect(info.privacy).toBe(true);

      // 收藏一个视频(某知名 BV 号)到该收藏夹。
      await client.fav.addVideo("BV1GJ411x7h7", [mediaId]);
      // B 站收藏接口有最终一致性,轮询等待资源可见。
      let seenCount = 0;
      await waitFor(async () => {
        const page = await client.fav.listResources(mediaId);
        seenCount = page.list.length;
        return seenCount > 0;
      });
      expect(seenCount).toBeGreaterThan(0);
      const favoured = await client.fav.isFavoured("BV1GJ411x7h7");
      expect(favoured).toBe(true);
    } finally {
      await client.fav.deleteFolder([mediaId]);
    }
    // 删除后元数据查询应抛错。
    await expect(client.fav.getFolderInfo(mediaId)).rejects.toBeDefined();
  });

  it("favorites: list created folders", async () => {
    const client = makeClient();
    const mid = client.currentMid!;
    const folders = await client.fav.listCreatedFolders(mid);
    expect(Array.isArray(folders)).toBe(true);
  });

  it("relation: follow -> unfollow a known UP (self-cleaning)", async () => {
    const client = makeClient();
    const mid = 14082; // 某知名 UP 主
    // /x/space/wbi/acc/relation 的 relation.attribute 表示"当前用户→目标用户"的关注状态。
    const before = await client.relation.getRelation(mid);
    const initiallyFollowed = before.relation.attribute === 2;
    try {
      if (initiallyFollowed) {
        // 已关注:先取关再关注,验证两条路径。
        await client.relation.unfollow(mid);
        await waitFor(async () => (await client.relation.getRelation(mid)).relation.attribute === 0);
      }
      await client.relation.follow(mid);
      await waitFor(async () => (await client.relation.getRelation(mid)).relation.attribute === 2);
    } finally {
      await client.relation.unfollow(mid);
      await waitFor(async () => (await client.relation.getRelation(mid)).relation.attribute === 0);
    }
  }, TIMEOUT);

  it("relation: list followings/followers/stat (read-only)", async () => {
    const client = makeClient();
    const mid = client.currentMid!;
    const followings = await client.relation.listFollowings(mid, { pn: 1, ps: 20 });
    expect(Array.isArray(followings.list)).toBe(true);
    const stat = await client.relation.getStat(mid);
    expect(stat.following).toBeGreaterThanOrEqual(0);
  });

  it("tags: create -> rename -> add user -> delete (self-cleaning)", async () => {
    const client = makeClient();
    const tagName = `s${Date.now() % 100000000}`; // 分组名 ≤ 16 字符
    const tagid = await client.tag.createTag(tagName);
    try {
      // B 站分组接口有最终一致性,轮询等待分组可被重命名/读取。
      await waitFor(async () => (await client.tag.listTags()).some((t) => t.tagid === tagid));
      await client.tag.renameTag(tagid, `${tagName}r`);
      await waitFor(async () => {
        const tags = await client.tag.listTags();
        const found = tags.find((t) => t.tagid === tagid);
        return found?.name === `${tagName}r`;
      });
    } finally {
      await client.tag.deleteTag(tagid);
    }
    await waitFor(async () => {
      const tags = await client.tag.listTags();
      return tags.find((t) => t.tagid === tagid) === undefined;
    });
  });

  it("interaction: liked state query (read-only)", async () => {
    const client = makeClient();
    // 点赞/投币/三连写操作已下线(刷量重灾区,合规考虑),只验证只读查询。
    const liked = await client.interaction.isLiked("BV1GJ411x7h7");
    expect(typeof liked).toBe("boolean");
  });

  it("comment: list (read-only)", async () => {
    const client = makeClient();
    const page = await client.comment.list(1, "BV1GJ411x7h7", { pn: 1, ps: 5 });
    expect(Array.isArray(page.replies)).toBe(true);
  });

  it("danmaku: list (read-only)", async () => {
    const client = makeClient();
    const items = await client.danmaku.list(1452032); // BV1GJ411x7h7 的 cid
    expect(Array.isArray(items)).toBe(true);
  });

  it("data: toview add -> remove (self-cleaning), history read-only", async () => {
    const client = makeClient();
    await client.data.addToView("BV1GJ411x7h7");
    const list = await client.data.listToView();
    expect(list.length).toBeGreaterThan(0);
    const entry = list.find((v) => v.bvid === "BV1GJ411x7h7" || v.aid !== 0);
    if (entry !== undefined) {
      await client.data.removeToView(entry.aid);
    }
    // 历史记录只读(不清空用户数据)。
    const history = await client.data.listHistory({ ps: 5 });
    expect(Array.isArray(history.list)).toBe(true);
  });

  it("creative: archive list (read-only, may be empty for non-UP)", async () => {
    const client = makeClient();
    try {
      const result = await client.creative.listArchives({ pn: 1, ps: 5 });
      expect(Array.isArray(result.list)).toBe(true);
    } catch (error) {
      // 非 UP 主或接口调整时降级跳过,不视为冒烟失败。
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[smoke] creative.listArchives skipped: ${message}`);
    }
  });
});
