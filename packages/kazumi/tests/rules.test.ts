/**
 * 规则模型与加载 —— Kazumi JSON 兼容 + 校验。
 */
import { describe, expect, it } from "vitest";
import { ruleFromJson, validateRule } from "../src/rules/loader.js";
import { RestrictedJsonPath } from "../src/engine/restricted-jsonpath.js";
import { KazumiError } from "../src/errors.js";

describe("ruleFromJson: Kazumi 规则 JSON 兼容", () => {
  it("解析 KazumiRules 真实形态(XPath 规则)", () => {
    const rule = ruleFromJson("AGE", {
      api: "1",
      type: "anime",
      name: "AGE",
      version: "1.5",
      muliSources: true,
      userAgent: "",
      baseURL: "https://example.com/",
      searchURL: "https://example.com/search?wd=@keyword",
      searchList: "//div[2]/div/section/div/div/div/div",
      searchName: "//div/div[2]/h5/a",
      searchResult: "//div/div[2]/h5/a",
      chapterRoads: "//div[2]/div/section/div/div[2]/div[2]/div[2]/div",
      chapterResult: "//ul/li/a",
    });
    expect(rule.name).toBe("AGE");
    expect(rule.baseUrl).toBe("https://example.com/");
    expect(rule.searchMode).toBe("xpath");
    expect(rule.chapterMode).toBe("xpath");
    expect(rule.muliSources).toBe(true);
    expect(validateRule(rule)).toEqual([]);
  });

  it("解析 API 模式规则(searchApiConfig/chapterApiConfig)", () => {
    const rule = ruleFromJson("API站", {
      api: "1",
      name: "API站",
      baseURL: "https://api.example.com",
      searchMode: "api",
      chapterMode: "api",
      searchApiConfig: {
        request: { method: "GET", url: "/search?kw={keyword}" },
        listPath: "$.data[*]",
        namePath: "$.title",
        sourcePath: "$.url",
      },
      chapterApiConfig: {
        request: { method: "GET", url: "/detail/{source}" },
        format: "nested",
        roadsPath: "$.data.roads[*]",
        roadNamePath: "$.name",
        episodesPath: "$.episodes[*]",
        episodeNamePath: "$.name",
        episodeUrlPath: "$.url",
      },
    });
    expect(rule.searchMode).toBe("api");
    expect(rule.searchApiConfig?.listPath).toBe("$.data[*]");
    expect(rule.chapterApiConfig?.format).toBe("nested");
    expect(validateRule(rule)).toEqual([]);
  });

  it("缺失字段取默认值(向后兼容)", () => {
    const rule = ruleFromJson("minimal", {
      api: "1",
      name: "minimal",
      baseURL: "https://x.com",
    });
    expect(rule.searchMode).toBe("xpath");
    expect(rule.muliSources).toBe(true);
  });

  it("未知字段忽略", () => {
    const rule = ruleFromJson("extra", {
      name: "extra",
      baseURL: "https://x.com",
      useWebview: true,
      useNativePlayer: true,
      adBlocker: false,
    });
    expect(rule.baseUrl).toBe("https://x.com");
  });
});

describe("validateRule: 非法规则拒绝", () => {
  it("缺少 baseURL → 错误", () => {
    const errors = validateRule(
      ruleFromJson("bad", { name: "bad" }),
    );
    expect(errors.join("; ")).toContain("baseURL");
  });

  it("XPath 模式缺搜索选择器 → 错误", () => {
    const errors = validateRule(
      ruleFromJson("bad", {
        name: "bad",
        baseURL: "https://x.com",
        searchMode: "xpath",
      }),
    );
    expect(errors.join("; ")).toContain("searchList");
  });

  it("API 模式非法 JSONPath → 错误", () => {
    const errors = validateRule(
      ruleFromJson("bad", {
        name: "bad",
        baseURL: "https://x.com",
        searchMode: "api",
        searchApiConfig: {
          request: { method: "GET", url: "/s" },
          listPath: "$.data.length()",
          namePath: "$.title",
          sourcePath: "$.url",
        },
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("RestrictedJsonPath 沙箱", () => {
  const doc = {
    data: [
      { title: "A", url: "/a", meta: { views: 10 } },
      { title: "B", url: "/b", meta: { views: 20 } },
    ],
  };

  it("读取列表/属性/索引/通配", () => {
    expect(RestrictedJsonPath.read(doc, "$.data[*]")).toHaveLength(2);
    expect(RestrictedJsonPath.readFirst(doc, "$.data[0].title")).toBe("A");
    expect(RestrictedJsonPath.read(doc, "$.data[*].url")).toEqual(["/a", "/b"]);
    expect(RestrictedJsonPath.readFirst(doc, "$.data[1].meta.views")).toBe(20);
    expect(RestrictedJsonPath.readFirst(doc, "$['data'][0]['title']")).toBe("A");
  });

  it("拒绝函数调用", () => {
    expect(() => RestrictedJsonPath.validate("$.data.length()")).toThrow();
  });

  it("拒绝过滤表达式", () => {
    expect(() => RestrictedJsonPath.validate("$.data[?(@.views>10)]")).toThrow();
  });

  it("拒绝递归下降与通配属性", () => {
    expect(() => RestrictedJsonPath.validate("$..title")).toThrow();
    expect(() => RestrictedJsonPath.validate("$.*")).toThrow();
  });

  it("拒绝切片与 union", () => {
    expect(() => RestrictedJsonPath.validate("$.data[1:3]")).toThrow();
    expect(() => RestrictedJsonPath.validate("$.data[0,1]")).toThrow();
  });

  it("拒绝空表达式与非 $ 开头", () => {
    expect(() => RestrictedJsonPath.validate("")).toThrow();
    expect(() => RestrictedJsonPath.validate("data[0]")).toThrow();
  });

  it("无匹配返回空数组(不抛错)", () => {
    expect(RestrictedJsonPath.read(doc, "$.missing")).toEqual([]);
  });
});
