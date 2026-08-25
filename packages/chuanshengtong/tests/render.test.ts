import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { ChuanshengtongErrorCode, render } from "../src/index.js";

/** PNG 文件签名 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "chuanshengtong-test-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("render 真实渲染(sharp 路径)", () => {
  it("渲染 PNG:文件存在、magic bytes、尺寸与模板一致", async () => {
    const output = join(dir, "dazibao.png");
    const result = await render({ template: "dazibao", text: "你好,世界", output });
    expect(result.format).toBe("png");
    expect(result.width).toBe(1200);
    expect(result.height).toBe(1600);
    expect(result.bytes).toBeGreaterThan(1000);
    const buf = readFileSync(output);
    expect(buf.subarray(0, 8)).toEqual(PNG_MAGIC);
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(1600);
  });

  it("渲染 JPEG:magic bytes 正确", async () => {
    const output = join(dir, "card.jpg");
    const result = await render({ template: "card", text: "一句话", output, format: "jpeg" });
    expect(result.format).toBe("jpeg");
    const buf = readFileSync(output);
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
    expect(buf[2]).toBe(0xff);
  });

  it("width 缩放:输出宽高按模板比例", async () => {
    const output = join(dir, "notice-small.png");
    const result = await render({ template: "notice", text: "通知", output, width: 600 });
    expect(result.width).toBe(600);
    expect(result.height).toBe(800); // 1600 × 600/1200
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(800);
  });

  it("覆盖字号与颜色", async () => {
    const output = join(dir, "bubble-override.png");
    const result = await render({
      template: "speech-bubble",
      text: "台词",
      output,
      fontSize: 40,
      color: "#123456",
    });
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("中文长文在容量内正常渲染", async () => {
    const output = join(dir, "dazibao-long.png");
    const text = "这是一段比较长的话,用来验证中文换行与模板容量。";
    const result = await render({ template: "dazibao", text: `${text}${text}`, output });
    expect(result.bytes).toBeGreaterThan(0);
  });
});

describe("render 错误分支", () => {
  it("未知模板 → TEMPLATE_NOT_FOUND", async () => {
    await expect(
      render({ template: "nope", text: "x", output: join(dir, "x.png") }),
    ).rejects.toMatchObject({ code: ChuanshengtongErrorCode.TEMPLATE_NOT_FOUND });
  });

  it("空文字 → EMPTY_TEXT", async () => {
    await expect(
      render({ template: "dazibao", text: "   ", output: join(dir, "x.png") }),
    ).rejects.toMatchObject({ code: ChuanshengtongErrorCode.EMPTY_TEXT });
  });

  it("超出模板容量 → TEXT_TOO_LONG", async () => {
    await expect(
      render({ template: "dazibao", text: "很".repeat(200), output: join(dir, "x.png") }),
    ).rejects.toMatchObject({ code: ChuanshengtongErrorCode.TEXT_TOO_LONG });
  });

  it("排版行数超限 → TEXT_TOO_LONG(card 90 字)", async () => {
    // card 单行 12 字,90 字排版 8 行 > maxLines 6
    await expect(
      render({ template: "card", text: "话".repeat(90), output: join(dir, "x.png") }),
    ).rejects.toMatchObject({ code: ChuanshengtongErrorCode.TEXT_TOO_LONG });
  });

  it("非法质量 → INVALID_OPTION", async () => {
    await expect(
      render({ template: "dazibao", text: "x", output: join(dir, "x.png"), quality: 0 }),
    ).rejects.toMatchObject({ code: ChuanshengtongErrorCode.INVALID_OPTION });
  });

  it("非法颜色 → INVALID_OPTION", async () => {
    await expect(
      render({ template: "dazibao", text: "x", output: join(dir, "x.png"), color: "not a color" }),
    ).rejects.toMatchObject({ code: ChuanshengtongErrorCode.INVALID_OPTION });
  });

  it("输出目录不存在 → WRITE_FAILED", async () => {
    await expect(
      render({ template: "dazibao", text: "x", output: join(dir, "no-such-dir", "x.png") }),
    ).rejects.toMatchObject({ code: ChuanshengtongErrorCode.WRITE_FAILED });
  });
});

describe("render 富文本渲染", () => {
  it("行内标记渲染出图(加粗/颜色/斜体)", async () => {
    const output = join(dir, "richtext.png");
    const text = "**[c:red]重点[/c]**提醒:*小心*";
    const result = await render({ template: "card", text, output });
    expect(result.bytes).toBeGreaterThan(0);
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(900);
  });

  it("未配对标记按字面输出,不报错", async () => {
    const output = join(dir, "plain-compat.png");
    const result = await render({ template: "dazibao", text: "2**3=8", output });
    expect(result.bytes).toBeGreaterThan(0);
  });
});
