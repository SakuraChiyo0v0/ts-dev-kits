import { describe, expect, it } from "vitest";
import { convertPlaceholders } from "../src/placeholder.js";

describe("convertPlaceholders", () => {
  describe("postgres(? → $n)", () => {
    it("无占位符的 SQL 原样返回", () => {
      expect(convertPlaceholders("SELECT 1", "postgres")).toBe("SELECT 1");
    });

    it("按出现顺序把 ? 转成 $1/$2/...", () => {
      expect(convertPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?", "postgres")).toBe(
        "SELECT * FROM t WHERE a = $1 AND b = $2",
      );
    });

    it("跳过单引号字符串内的 ?(字面量)", () => {
      expect(convertPlaceholders("SELECT 'a?b', x = ? FROM t", "postgres")).toBe(
        "SELECT 'a?b', x = $1 FROM t",
      );
    });

    it("处理转义引号 ''(字符串内的引号不结束字符串)", () => {
      expect(convertPlaceholders("SELECT 'it''s ? here', x = ? FROM t", "postgres")).toBe(
        "SELECT 'it''s ? here', x = $1 FROM t",
      );
    });

    it("`??` 转义为字面 ?,不当作占位符(JSONB 单 ? 操作符)", () => {
      expect(convertPlaceholders("SELECT data ?? 'key' FROM t WHERE id = ?", "postgres")).toBe(
        "SELECT data ? 'key' FROM t WHERE id = $1",
      );
    });

    it("`?|` / `?&` 多字符操作符原样保留", () => {
      expect(convertPlaceholders("SELECT * FROM t WHERE data ?| ? AND data ?& ?", "postgres")).toBe(
        "SELECT * FROM t WHERE data ?| $1 AND data ?& $2",
      );
    });
  });

  describe("sqlite / mysql(? 原生保留)", () => {
    it("? 保持不变,`??` 不做转义(仅 postgres 支持)", () => {
      expect(convertPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?", "sqlite")).toBe(
        "SELECT * FROM t WHERE a = ? AND b = ?",
      );
      expect(convertPlaceholders("SELECT ?? FROM t", "sqlite")).toBe("SELECT ?? FROM t");
      expect(convertPlaceholders("SELECT data ?? 'key' WHERE id = ?", "mysql")).toBe(
        "SELECT data ?? 'key' WHERE id = ?",
      );
    });

    it("跳过单引号字符串内的 ?", () => {
      expect(convertPlaceholders("SELECT 'a?b', x = ? FROM t", "sqlite")).toBe(
        "SELECT 'a?b', x = ? FROM t",
      );
    });
  });
});
