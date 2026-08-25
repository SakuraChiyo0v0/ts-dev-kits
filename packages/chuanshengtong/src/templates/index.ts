/**
 * 内置模板注册表:模板的权威集合,顺序与 types.ts 的 TEMPLATE_IDS 一致。
 * 新增模板:在 types.ts 的 TEMPLATE_IDS 追加 id,在此注册实现。
 */
import { card } from "./card.js";
import { dazibao } from "./dazibao.js";
import { notice } from "./notice.js";
import { speechBubble } from "./speech-bubble.js";
import type { TemplateDefinition } from "../types.js";

export const TEMPLATES: readonly TemplateDefinition[] = [dazibao, speechBubble, card, notice];

/** 按 id 查找模板定义,不存在返回 undefined */
export function getTemplateDefinition(id: string): TemplateDefinition | undefined {
  return TEMPLATES.find((template) => template.id === id);
}
