import { describe, expect, it } from "vitest";
import { ChuanshengtongError, ChuanshengtongErrorCode } from "../src/errors.js";
import { getTemplate, listTemplates } from "../src/index.js";
import { TEMPLATE_IDS } from "../src/types.js";

describe("内置模板注册表", () => {
  it("listTemplates 返回全部模板,id 与 TEMPLATE_IDS 一致", () => {
    const templates = listTemplates();
    expect(templates.map((t) => t.id)).toEqual([...TEMPLATE_IDS]);
    for (const t of templates) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.width).toBeGreaterThan(0);
      expect(t.height).toBeGreaterThan(0);
      expect(t.maxTextLength).toBeGreaterThan(0);
    }
  });

  it("getTemplate 返回指定模板信息", () => {
    const dazibao = getTemplate("dazibao");
    expect(dazibao.name).toBe("大字报");
    expect(dazibao.maxTextLength).toBeGreaterThan(0);
  });

  it("未知模板抛 TEMPLATE_NOT_FOUND", () => {
    expect(() => getTemplate("nope")).toThrowError(ChuanshengtongError);
    try {
      getTemplate("nope");
    } catch (err) {
      expect((err as ChuanshengtongError).code).toBe(ChuanshengtongErrorCode.TEMPLATE_NOT_FOUND);
    }
  });
});
