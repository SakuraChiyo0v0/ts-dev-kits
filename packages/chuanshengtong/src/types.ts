/**
 * 传声筒核心类型定义。
 * 模板 id / 文本区 / 渲染选项的字段语义以此文件为权威。
 */

/** 内置模板 id 枚举(权威定义,新增模板在此扩展) */
export const TEMPLATE_IDS = ["dazibao", "speech-bubble", "card", "notice"] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** 输出图片格式 */
export type OutputFormat = "png" | "jpeg";

/** 文本区水平对齐方式 */
export type TextAlign = "center" | "left";

/**
 * 富文本片段:一段具有统一样式的文字。
 * 由 parseRichText 从行内标记解析而来:
 *   **加粗** / *斜体* / [c:red]彩色[/c](CSS 颜色名或 #hex),可叠加。
 */
export interface RichRun {
  /** 片段文本(不含标记字符) */
  text: string;
  /** 加粗 */
  bold?: boolean;
  /** 斜体 */
  italic?: boolean;
  /** 行内文字颜色 */
  color?: string;
}

/** 文本区配置(模板坐标系内的像素值) */
export interface TextRegion {
  /** 文本区左上角 x(px) */
  x: number;
  /** 文本区左上角 y(px) */
  y: number;
  /** 文本区宽度(px) */
  width: number;
  /** 文本区高度(px) */
  height: number;
  /** 水平对齐 */
  align: TextAlign;
  /** 行高(px) */
  lineHeight: number;
  /** 默认字号(px) */
  defaultFontSize: number;
  /** 最大行数(超出抛 TEXT_TOO_LONG) */
  maxLines: number;
  /** 默认文字颜色(CSS 颜色) */
  defaultColor: string;
}

/** 模板对外信息(listTemplates / getTemplate 返回) */
export interface TemplateInfo {
  id: TemplateId;
  /** 中文名 */
  name: string;
  /** 一句话说明 */
  description: string;
  /** 模板固有宽度(px) */
  width: number;
  /** 模板固有高度(px) */
  height: number;
  /** 单次可容纳的最大字数(超出抛 TEXT_TOO_LONG) */
  maxTextLength: number;
}

/**
 * 模板内部定义:在 TemplateInfo 之上增加文本区配置与 SVG 骨架生成函数。
 * 仅内部使用,不通过公共出口导出。
 */
export interface TemplateDefinition extends TemplateInfo {
  /** 文本区配置 */
  textRegion: TextRegion;
  /**
   * 生成完整 SVG 骨架(含背景/装饰/文本层)。
   * @param textLayer 已排版好的文本层 SVG(含全部 <text>/<tspan> 元素),模板直接插入正文区域
   * @param opts      生效的字号与全局文字颜色(可能被 RenderOptions 覆盖)
   */
  buildSvg: (textLayer: string, opts: { fontSize: number; color: string }) => string;
}

/** 渲染参数 */
export interface RenderOptions {
  /** 模板 id(listTemplates 返回的 id) */
  template: string;
  /** 要传的文字,非空,长度 ≤ 模板 maxTextLength */
  text: string;
  /** 输出文件路径(格式由 format 决定,与扩展名无关) */
  output: string;
  /** 输出格式,默认 "png" */
  format?: OutputFormat;
  /** 输出宽度(px),默认模板宽度;高度按模板比例缩放 */
  width?: number;
  /** 覆盖模板默认字号(px) */
  fontSize?: number;
  /** 覆盖模板默认文字颜色(CSS 颜色) */
  color?: string;
  /** jpeg 质量 1-100,默认 90 */
  quality?: number;
}

/** 渲染结果 */
export interface RenderResult {
  /** 输出文件路径 */
  outputPath: string;
  /** 实际输出宽度(px) */
  width: number;
  /** 实际输出高度(px) */
  height: number;
  /** 输出格式 */
  format: OutputFormat;
  /** 文件字节数 */
  bytes: number;
}
