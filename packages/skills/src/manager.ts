/**
 * Skill 管理器 —— SKILL.md 文件式技能加载。
 * 扫描 skills 目录，解析每个 SKILL.md，暴露为 LLM 工具。
 * 参考 hermes 的 skill_manager_tool 设计：SKILL.md + frontmatter 即技能。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LlmTool } from "@amechan/llm";
import {
  findSkillFiles,
  parseSkillContent,
  validateSkillContent,
  type SkillMeta,
} from "./parser.js";

/** 技能工具执行时传入的输入参数（统一为 input 字段） */
export interface SkillInvokeArgs {
  input?: string;
  [key: string]: unknown;
}

/** 默认技能目录（应用数据目录下） */
export function defaultSkillsDir(userData: string): string {
  return path.join(userData, "skills");
}

export class SkillManager {
  readonly #dir: string;
  /** 已加载的技能元数据（name → meta） */
  #skills = new Map<string, SkillMeta>();
  /** 技能 → LLM 工具的映射 */
  #tools = new Map<string, LlmTool>();
  #loaded = false;

  constructor(dir: string) {
    this.#dir = dir;
  }

  /** 重新扫描技能目录 */
  async reload(): Promise<void> {
    await fs.mkdir(this.#dir, { recursive: true });
    this.#skills.clear();
    this.#tools.clear();

    const files = await findSkillFiles(this.#dir);
    for (const file of files) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const error = validateSkillContent(content);
        if (error) {
          console.warn(`[Skill] 跳过 ${file}: ${error}`);
          continue;
        }
        const meta = parseSkillContent(content);
        if (!meta.name || this.#skills.has(meta.name)) continue;
        this.#skills.set(meta.name, meta);
        this.#tools.set(meta.name, skillToTool(meta));
      } catch (e) {
        console.warn(`[Skill] 读取 ${file} 失败:`, e);
      }
    }
    this.#loaded = true;
    console.info(`[Skill] 已加载 ${this.#skills.size} 个技能`);
  }

  /** 当前启用的技能列表 */
  list(): SkillMeta[] {
    return [...this.#skills.values()];
  }

  /** 当前可用的 LLM 工具列表 */
  getTools(): LlmTool[] {
    return [...this.#tools.values()];
  }

  /** 技能是否已加载 */
  has(name: string): boolean {
    return this.#skills.has(name);
  }

  get loaded(): boolean {
    return this.#loaded;
  }

  /** 技能目录路径 */
  get dir(): string {
    return this.#dir;
  }
}

/** 把技能元数据转成 LLM 工具。输入统一为 input 字符串，指令作为 system 提示。 */
function skillToTool(meta: SkillMeta): LlmTool {
  return {
    name: meta.name,
    description: meta.description,
    parameters: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "交给技能处理的输入内容（问题/指令/文本）",
        },
      },
      required: ["input"],
    },
    async execute(args: SkillInvokeArgs): Promise<string> {
      const input = typeof args.input === "string" ? args.input : "";
      // 技能执行：把 SKILL.md 指令 + 用户输入组装成提示，返回给 LLM 继续处理。
      // 这是「技能作为上下文注入」模式：技能正文描述了处理流程，最终由 LLM 依据它产出。
      return [
        `技能「${meta.name}」的指令如下（请严格遵循执行）：`,
        "---",
        meta.body,
        "---",
        "用户输入：",
        input || "（无输入）",
      ].join("\n");
    },
  };
}
