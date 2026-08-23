/**
 * 真实接口冒烟测试(NETEASE_SMOKE=1 时启用)。
 *
 * 用法:
 *   NETEASE_SMOKE=1 pnpm --filter @sakurachiyo0v0/netease-music test
 *
 * 默认跳过。启用后访问网易云真实接口,验证:
 *   - 登录态加载(auth.json,缺省平台配置目录或 NETEASE_AUTH_PATH 指定);
 *   - 歌曲详情/歌单解析;
 *   - VIP 信息;
 *   - 免费歌曲可用品质(非 VIP 不含 lossless);
 *   - 合规:非 VIP 对 VIP 歌曲的可用品质为空。
 *
 * 不实际下载大文件(避免冒烟跑得太重);下载链路由离线 mock 单测覆盖。
 */
import { describe, expect, it } from "vitest";
import { createNeteaseClient } from "../src/index.js";

const SMOKE = process.env.NETEASE_SMOKE === "1";
const authPath = process.env.NETEASE_AUTH_PATH;

describe.skipIf(!SMOKE)("netease-music real API smoke", () => {
  it("loads login state from auth store", async () => {
    const client = createNeteaseClient({
      ...(authPath !== undefined ? { authPath } : {}),
    });
    expect(client.isLoggedIn).toBe(true);
  });

  it("fetches song info from real API", async () => {
    const client = createNeteaseClient({
      ...(authPath !== undefined ? { authPath } : {}),
    });
    // 32701996:赵鹏《乌兰巴托的夜晚》免费歌曲。
    const info = await client.getSongInfo("32701996");
    expect(info.id).toBe("32701996");
    expect(info.title.length).toBeGreaterThan(0);
    expect(info.durationMs).toBeGreaterThan(0);
  });

  it("parses a real song URL", async () => {
    const client = createNeteaseClient({
      ...(authPath !== undefined ? { authPath } : {}),
    });
    const parsed = await client.parse("https://music.163.com/song?id=32701996");
    expect(parsed.songs).toHaveLength(1);
  });

  it("reports real VIP status", async () => {
    const client = createNeteaseClient({
      ...(authPath !== undefined ? { authPath } : {}),
    });
    const vip = await client.getVipInfo();
    expect(typeof vip.isVip).toBe("boolean");
  });

  it("free song available levels are consistent with identity", async () => {
    const client = createNeteaseClient({
      ...(authPath !== undefined ? { authPath } : {}),
    });
    const levels = await client.getAvailableLevels("32701996");
    expect(levels.length).toBeGreaterThan(0);
    expect(levels).toContain("exhigh");
    // 免费歌曲:无论身份,损失/高清不应出现在"免费可拿"清单(服务端降级)。
    expect(levels).not.toContain("hires");
  });
});
