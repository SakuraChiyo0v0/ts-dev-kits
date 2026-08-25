/**
 * 传声筒公共出口:只导出稳定 API。
 * 用法:
 *   import { listTemplates, render } from "@sakurachiyo0v0/chuanshengtong";
 *   await render({ template: "dazibao", text: "你好,世界", output: "out.png" });
 */
export { listTemplates, getTemplate, render } from "./render.js";
export { wrapText, charWidth } from "./wrap.js";
export { ChuanshengtongError, ChuanshengtongErrorCode } from "./errors.js";
export type {
  TemplateInfo,
  RenderOptions,
  RenderResult,
  OutputFormat,
  TemplateId,
  TextRegion,
} from "./types.js";
export type { WrapOptions, WrapResult } from "./wrap.js";
