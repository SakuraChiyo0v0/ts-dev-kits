/**
 * 引擎与客户端 —— mock 番剧站真实协议路径(XPath + API 双模式全链路)。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAnimeClient } from "../src/client.js";
import { ruleFromJson } from "../src/rules/loader.js";
import { KazumiError } from "../src/errors.js";
import { startMockServer } from "./helpers/mock-server.js";

let server: { baseUrl: string; close: () => Promise<void> };

beforeAll(async () => {
  server = await startMockServer();
});

afterAll(async () => {
  await server.close();
});

function writeRule(name: string, json: Record<string, unknown>, dir: string): void {
  const { writeFileSync } = require("node:fs") as typeof import("node:fs");
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(json), "utf-8");
}

function xpathRule(baseUrl: string) {
  return {
    api: "1",
    type: "anime",
    name: "mock-xpath",
    version: "1.0",
    muliSources: true,
    userAgent: "test-agent",
    baseURL: baseUrl,
    searchURL: `${baseUrl}/search?keyword=@keyword`,
    searchList: "//section/div/div/div",
    searchName: "//h5/a",
    searchResult: "//h5/a",
    chapterRoads: "//body/div[1]",
    chapterResult: "//ul/li/a",
  };
}

function apiRule(baseUrl: string) {
  return {
    api: "1",
    name: "mock-api",
    baseURL: baseUrl,
    searchMode: "api",
    chapterMode: "api",
    searchApiConfig: {
      request: { method: "GET", url: `${baseUrl}/search-api?keyword={keyword}` },
      listPath: "$.data[*]",
      namePath: "$.title",
      sourcePath: "$.url",
    },
    chapterApiConfig: {
      request: { method: "GET", url: "{source}" },
      format: "nested",
      roadsPath: "$.data.roads[*]",
      roadNamePath: "$.name",
      episodesPath: "$.episodes[*]",
      episodeNamePath: "$.name",
      episodeUrlPath: "$.url",
    },
  };
}

describe("XPath 模式全链路", () => {
  it("搜索 → 线路 → 集数 → 下载(mock 站真实协议)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kazumi-test-"));
    writeRule("mock-xpath", xpathRule(server.baseUrl), dir);
    const client = createAnimeClient({ rulesDir: dir });

    const items = await client.search("测试");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.name).toContain("测试");
    const src = items[0]!.src;
    expect(src).toContain("/detail/");

    const roads = await client.getRoads(items[0]!);
    expect(roads.length).toBeGreaterThan(0);
    const episodes = await client.getEpisodes(items[0]!, roads[0]!);
    expect(episodes.length).toBeGreaterThan(0);

    // 下载:注入假 ffmpeg run,验证分片下载 + 本地 m3u8 构建链路
    const seenArgs: string[][] = [];
    const downloader = await import("../src/stream/download.js");
    const downloaderInstance = new downloader.EpisodeDownloader(fetch, {}, (args) => {
      seenArgs.push(args);
      return Promise.resolve({});
    });
    const result = await downloaderInstance.download(
      ruleFromJson("mock-xpath", xpathRule(server.baseUrl)),
      episodes[0]!,
      { outputDir: dir },
    );
    expect(result.filePath).toContain(".mp4");
    expect(seenArgs.length).toBe(1);
    const args = seenArgs[0]!;
    expect(args).toContain("-c");
    expect(args).toContain("copy");

    // 播放页型集数:HTML 含 <video> 标签 → resolver 解析出 m3u8 → 下载
    const playPageEpisode = episodes.find((ep) => ep.url.endsWith("play-page.html"));
    expect(playPageEpisode).toBeDefined();
    const result2 = await downloaderInstance.download(
      ruleFromJson("mock-xpath", xpathRule(server.baseUrl)),
      playPageEpisode!,
      { outputDir: dir },
    );
    expect(result2.filePath).toContain(".mp4");
    expect(seenArgs.length).toBe(2);

    rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it("广告过滤:默认剔除 discontinuity 广告分组", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kazumi-test-"));
    writeRule("mock-xpath", xpathRule(server.baseUrl), dir);
    const client = createAnimeClient({ rulesDir: dir });
    const rule = await client.rules.load("mock-xpath");

    const downloader = await import("../src/stream/download.js");
    const seenArgs: string[][] = [];
    const instance = new downloader.EpisodeDownloader(fetch, {}, (args) => {
      seenArgs.push(args);
      return Promise.resolve({});
    });
    // 直接喂带广告的 playlist,通过注入 ffmpeg run 拦截前的分片下载验证
    const { parseM3u8, buildLocalM3u8 } = await import("../src/stream/m3u8.js");
    const { filterAds } = await import("../src/stream/ad-filter.js");
    const raw = readFileSync(
      join(import.meta.dirname, "fixtures", "ad-playlist.m3u8"),
      "utf-8",
    );
    const media = parseM3u8(raw).media!;
    const filtered = filterAds(media);
    expect(filtered.segments.length).toBe(2);
    expect(filtered.segments.every((s) => s.discontinuityGroup === 1)).toBe(true);
    const local = buildLocalM3u8(filtered, {
      segmentNames: ["seg_00000.ts", "seg_00001.ts"],
      keyUriToLocal: new Map(),
    });
    expect(local).toContain("seg_00000.ts");
    expect(local).not.toContain("ad_");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("API 模式全链路", () => {
  it("搜索 → 线路 → 集数", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kazumi-test-"));
    writeRule("mock-api", apiRule(server.baseUrl), dir);
    const client = createAnimeClient({ rulesDir: dir });

    const items = await client.search("测试", { rules: ["mock-api"] });
    expect(items.length).toBe(2);
    expect(items[0]!.name).toContain("测试");

    const roads = await client.getRoads(items[0]!);
    expect(roads.length).toBe(2);
    expect(roads[0]!.name).toBe("线路1");
    const episodes = await client.getEpisodes(items[0]!, roads[0]!);
    expect(episodes).toHaveLength(2);
    expect(episodes[0]!.name).toBe("第1集");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("规则追踪与错误分支", () => {
  it("traceSearch 返回原始响应与诊断", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kazumi-test-"));
    writeRule("mock-xpath", xpathRule(server.baseUrl), dir);
    const client = createAnimeClient({ rulesDir: dir });
    const trace = await client.traceSearch("mock-xpath", "测试");
    expect(trace.items.length).toBeGreaterThan(0);
    expect(trace.rawResponse).toContain("<!DOCTYPE html>");
    rmSync(dir, { recursive: true, force: true });
  });

  it("空规则目录 → RULE_NOT_FOUND", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kazumi-empty-"));
    const client = createAnimeClient({ rulesDir: dir });
    await expect(client.search("x")).rejects.toMatchObject({
      code: "RULE_NOT_FOUND",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("加载不存在规则 → RULE_NOT_FOUND", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kazumi-empty-"));
    const client = createAnimeClient({ rulesDir: dir });
    await expect(client.rules.load("nope")).rejects.toThrow(KazumiError);
    rmSync(dir, { recursive: true, force: true });
  });

  it("非法规则 JSON → RULE_INVALID", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kazumi-empty-"));
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(join(dir, "broken.json"), "{ not json", "utf-8");
    const client = createAnimeClient({ rulesDir: dir });
    await expect(client.rules.load("broken")).rejects.toThrowError(
      expect.objectContaining({ code: "RULE_INVALID" }),
    );
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("CAPTCHA 感知", () => {
  it("页面含验证码特征 → CAPTCHA", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kazumi-test-"));
    writeRule("mock-captcha", {
      ...xpathRule(server.baseUrl),
      searchURL: `${server.baseUrl}/search?keyword=@keyword&captcha=1`,
      antiCrawlerConfig: { enabled: true, captchaDetectValue: "verify-token" },
    }, dir);
    // mock 服务器不认识 captcha=1 参数,这里用伪造 fetch 模拟挑战页
    const client = createAnimeClient({
      rulesDir: dir,
      fetchImpl: (async () =>
        new Response('<html><body>verify-token challenge</body></html>', {
          status: 200,
          headers: { "content-type": "text/html" },
        })) as typeof fetch,
    });
    await expect(client.search("测试", { rules: ["mock-captcha"] })).rejects.toMatchObject({
      code: "CAPTCHA",
    });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("RuleManager add/remove", () => {
  it("add 校验通过并写入,remove 删除", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kazumi-test-"));
    const client = createAnimeClient({ rulesDir: dir });
    const rule = xpathRule(server.baseUrl);
    const name = await client.rules.add(rule);
    expect(name).toBe("mock-xpath");
    expect(client.rules.list()).toContain("mock-xpath");
    // 加载后搜索可用
    const items = await client.search("测试", { rules: ["mock-xpath"] });
    expect(items.length).toBeGreaterThan(0);
    await client.rules.remove("mock-xpath");
    expect(client.rules.list()).not.toContain("mock-xpath");
    await expect(client.rules.load("mock-xpath")).rejects.toThrowError(
      expect.objectContaining({ code: "RULE_NOT_FOUND" }),
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("add 非法规则拒绝写入", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kazumi-test-"));
    const client = createAnimeClient({ rulesDir: dir });
    await expect(
      client.rules.add({ name: "bad", baseURL: "" } as Record<string, unknown>),
    ).rejects.toThrowError(expect.objectContaining({ code: "RULE_INVALID" }));
    expect(client.rules.list()).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("remove 不存在规则 → RULE_NOT_FOUND", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kazumi-test-"));
    const client = createAnimeClient({ rulesDir: dir });
    await expect(client.rules.remove("nope")).rejects.toThrowError(
      expect.objectContaining({ code: "RULE_NOT_FOUND" }),
    );
    rmSync(dir, { recursive: true, force: true });
  });
});
