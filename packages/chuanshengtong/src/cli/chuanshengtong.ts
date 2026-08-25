#!/usr/bin/env node
/**
 * amechan-chuanshengtong CLI:list / render。
 * 用法:
 *   amechan-chuanshengtong list
 *   amechan-chuanshengtong render "要传的话" --template dazibao --output out.png
 */
import {
  CliError,
  getNumber,
  getString,
  handleCliError,
  outputError,
  outputJson,
  printHelp,
  parseArgs,
} from "@sakurachiyo0v0/cli-utils";
import { ChuanshengtongError } from "../errors.js";
import { listTemplates, render } from "../index.js";
import type { OutputFormat } from "../types.js";

const USAGE = "amechan-chuanshengtong <command> [options]";
const COMMANDS = [
  { name: "help", desc: "显示帮助" },
  { name: "list", desc: "列出内置模板(id/名称/尺寸/容量)" },
  { name: "render <text>", desc: "用模板生成图片(--template 默认 dazibao;--output 默认 chuanshengtong-<时间戳>.png)" },
];
const OPTIONS = [
  { flag: "--template <id>", desc: "模板 id(默认 dazibao;list 查看全部)" },
  { flag: "--output <path>", desc: "输出文件路径(默认 chuanshengtong-<时间戳>.png)" },
  { flag: "--format <png|jpeg>", desc: "输出格式(默认 png)" },
  { flag: "--width <px>", desc: "输出宽度(默认模板宽度)" },
  { flag: "--font-size <px>", desc: "覆盖默认字号" },
  { flag: "--color <css>", desc: "覆盖默认文字颜色" },
  { flag: "--quality <1-100>", desc: "jpeg 质量(默认 90)" },
];

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positionals[0];
  if (command === undefined || command === "help") {
    printHelp(USAGE, COMMANDS, OPTIONS);
    return;
  }

  switch (command) {
    case "list": {
      outputJson(listTemplates());
      return;
    }
    case "render": {
      const text = args.positionals[1];
      if (text === undefined) {
        throw new CliError("render 需要要传的文字:amechan-chuanshengtong render <text> [options]");
      }
      const format = getString(args, "format");
      const width = getNumber(args, "width");
      const fontSize = getNumber(args, "font-size");
      const quality = getNumber(args, "quality");
      const color = getString(args, "color");
      const result = await render({
        template: getString(args, "template") ?? "dazibao",
        text,
        output: getString(args, "output") ?? `chuanshengtong-${Date.now()}.png`,
        ...(format !== undefined ? { format: format as OutputFormat } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(fontSize !== undefined ? { fontSize } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(quality !== undefined ? { quality } : {}),
      });
      outputJson(result);
      return;
    }
    default:
      throw new CliError(`未知命令: ${command}(运行 amechan-chuanshengtong help 查看用法)`);
  }
}

run().catch((err: unknown) => {
  if (err instanceof ChuanshengtongError) {
    // 统一错误输出带错误码,便于排查(如 [TEXT_TOO_LONG] [TEMPLATE_NOT_FOUND])
    outputError(`[${err.code}] ${err.message}`);
    process.exit(1);
  }
  handleCliError(err);
});
