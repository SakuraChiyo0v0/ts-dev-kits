/**
 * 渲染主逻辑:校验参数 → 排版 → 模板生成 SVG → sharp 栅格化 → 写文件。
 */
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { ChuanshengtongError, ChuanshengtongErrorCode } from "./errors.js";
import { TEMPLATES, getTemplateDefinition } from "./templates/index.js";
import { wrapText } from "./wrap.js";
import type { OutputFormat, RenderOptions, RenderResult, TemplateInfo } from "./types.js";

const FORMATS: readonly OutputFormat[] = ["png", "jpeg"];

/** CSS 颜色宽松校验:hex / 颜色名 / rgb()/rgba() */
const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{3,30}$|^rgba?\([\d.,%\s]+\)$/;

function toInfo(
  def: (typeof TEMPLATES)[number],
): TemplateInfo {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    width: def.width,
    height: def.height,
    maxTextLength: def.maxTextLength,
  };
}

/** 列出全部内置模板 */
export function listTemplates(): TemplateInfo[] {
  return TEMPLATES.map(toInfo);
}

/** 按 id 获取模板信息,不存在抛 TEMPLATE_NOT_FOUND */
export function getTemplate(id: string): TemplateInfo {
  const def = getTemplateDefinition(id);
  if (def === undefined) {
    throw new ChuanshengtongError(
      ChuanshengtongErrorCode.TEMPLATE_NOT_FOUND,
      `未知模板 "${id}",可用 listTemplates() 查看全部模板`,
    );
  }
  return toInfo(def);
}

/** 校验渲染参数,非法直接抛 ChuanshengtongError */
function validateOptions(options: RenderOptions): {
  def: NonNullable<ReturnType<typeof getTemplateDefinition>>;
  format: OutputFormat;
  width: number;
  fontSize: number;
  color: string;
  quality: number;
} {
  const def = getTemplateDefinition(options.template);
  if (def === undefined) {
    throw new ChuanshengtongError(
      ChuanshengtongErrorCode.TEMPLATE_NOT_FOUND,
      `未知模板 "${options.template}",可用 listTemplates() 查看全部模板`,
    );
  }
  if (options.text.trim() === "") {
    throw new ChuanshengtongError(ChuanshengtongErrorCode.EMPTY_TEXT, "文字不能为空");
  }
  if (options.text.length > def.maxTextLength) {
    throw new ChuanshengtongError(
      ChuanshengtongErrorCode.TEXT_TOO_LONG,
      `文字长度 ${options.text.length} 超过模板 "${def.id}" 容量 ${def.maxTextLength},请缩短或换模板`,
    );
  }
  const format = options.format ?? "png";
  if (!FORMATS.includes(format)) {
    throw new ChuanshengtongError(
      ChuanshengtongErrorCode.INVALID_OPTION,
      `未知输出格式 "${format}",支持 png / jpeg`,
    );
  }
  const width = options.width ?? def.width;
  if (!Number.isFinite(width) || width <= 0) {
    throw new ChuanshengtongError(ChuanshengtongErrorCode.INVALID_OPTION, "width 必须为正数");
  }
  const fontSize = options.fontSize ?? def.textRegion.defaultFontSize;
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    throw new ChuanshengtongError(ChuanshengtongErrorCode.INVALID_OPTION, "fontSize 必须为正数");
  }
  const color = options.color ?? def.textRegion.defaultColor;
  if (!COLOR_PATTERN.test(color)) {
    throw new ChuanshengtongError(ChuanshengtongErrorCode.INVALID_OPTION, `非法文字颜色 "${color}"`);
  }
  const quality = options.quality ?? 90;
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new ChuanshengtongError(
      ChuanshengtongErrorCode.INVALID_OPTION,
      "quality 必须在 1-100 之间",
    );
  }
  return { def, format, width, fontSize, color, quality };
}

/** 渲染:文字 + 模板 → 图片文件 */
export async function render(options: RenderOptions): Promise<RenderResult> {
  const { def, format, width, fontSize, color, quality } = validateOptions(options);

  // 排版;行数超出模板容量 → TEXT_TOO_LONG(不静默丢字)
  const { lines, truncated } = wrapText(options.text, {
    fontSize,
    maxWidth: def.textRegion.width,
    maxLines: def.textRegion.maxLines,
  });
  if (truncated) {
    throw new ChuanshengtongError(
      ChuanshengtongErrorCode.TEXT_TOO_LONG,
      `文字在模板 "${def.id}" 中超过 ${def.textRegion.maxLines} 行,请缩短或换模板`,
    );
  }

  const svg = def.buildSvg(lines, { fontSize, color });

  // sharp 栅格化(真实渲染路径);失败归 RENDER_FAILED
  let buffer: Buffer;
  try {
    let pipeline = sharp(Buffer.from(svg)).resize({ width });
    if (format === "jpeg") {
      pipeline = pipeline.jpeg({ quality });
    } else {
      pipeline = pipeline.png();
    }
    buffer = await pipeline.toBuffer();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ChuanshengtongError(
      ChuanshengtongErrorCode.RENDER_FAILED,
      `图片渲染失败:${message}`,
    );
  }

  // 写文件;失败归 WRITE_FAILED
  try {
    await writeFile(options.output, buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ChuanshengtongError(
      ChuanshengtongErrorCode.WRITE_FAILED,
      `写入输出文件失败:${message}`,
    );
  }

  return {
    outputPath: options.output,
    width,
    height: Math.round((def.height * width) / def.width),
    format,
    bytes: buffer.length,
  };
}
