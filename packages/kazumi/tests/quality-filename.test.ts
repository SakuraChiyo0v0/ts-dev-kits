/**
 * 线路质量排序与文件名标准化测试。
 */
import { describe, expect, it } from "vitest";
import { roadQualityRank, sortRoadsByQuality, type Road } from "../src/types.js";
import { normalizeEpisodeName, sanitizeFilename } from "../src/stream/download.js";

function road(name: string): Road {
  return { name, data: [], identifier: [] };
}

describe("roadQualityRank / sortRoadsByQuality", () => {
  it("清晰度档位:4K > 1080P > 720P > 标清 > 无标记", () => {
    expect(roadQualityRank("4K 线路")).toBeGreaterThan(roadQualityRank("1080P 线路"));
    expect(roadQualityRank("1080P")).toBeGreaterThan(roadQualityRank("720P"));
    expect(roadQualityRank("720P")).toBeGreaterThan(roadQualityRank("标清"));
    expect(roadQualityRank("标清")).toBeGreaterThan(roadQualityRank("默认线路"));
    expect(roadQualityRank("默认线路")).toBe(0);
  });

  it("排序:高清晰度线路排前", () => {
    const sorted = sortRoadsByQuality([
      road("线路1"),
      road("1080P 高清"),
      road("4K 蓝光"),
      road("标清"),
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["4K 蓝光", "1080P 高清", "标清", "线路1"]);
  });

  it("同档位按名称稳定排序", () => {
    const sorted = sortRoadsByQuality([road("B线"), road("A线")]);
    expect(sorted.map((r) => r.name)).toEqual(["A线", "B线"]);
  });
});

describe("normalizeEpisodeName / sanitizeFilename", () => {
  it("集数补零:「第3集」→「第03集」", () => {
    expect(normalizeEpisodeName("第3集")).toBe("第03集");
  });

  it("已两位保持不变:「第12集」→「第12集」", () => {
    expect(normalizeEpisodeName("第12集")).toBe("第12集");
  });

  it("话/回也补零:「第5话」→「第05话」", () => {
    expect(normalizeEpisodeName("第5话")).toBe("第05话");
  });

  it("非集数格式原样返回", () => {
    expect(normalizeEpisodeName("特别篇")).toBe("特别篇");
  });

  it("sanitizeFilename 清理非法字符", () => {
    expect(sanitizeFilename('间谍过家家: 第三季')).toBe("间谍过家家_ 第三季");
  });
});
