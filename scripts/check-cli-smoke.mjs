#!/usr/bin/env node
/**
 * scripts/check-cli-smoke.mjs —— CLI 冒烟测试
 *
 * 遍历各包 package.json 的 bin 条目,对每个 CLI 跑 `help`,断言:
 *   - 进程没有崩溃(输出含 usage/命令清单,或退出码为 0);
 *   - 输出不含异常堆栈(如 "at foo (" 的调用栈)。
 *
 * 目的:抓"CLI 启动即崩 / 命令表损坏 / 打包缺入口"这类回归;
 * 命令集与参数的一致性由 scripts/check-skill-staleness.mjs 守卫,此处不重复。
 * dist 未构建的包跳过并提示(CI 的 check 在 build 之后跑,应全量覆盖)。
 *
 * 用法: node scripts/check-cli-smoke.mjs
 * 退出码:0=通过;1=有 CLI 冒烟失败。
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

/** 收集全部 bin 条目:[{ cmd, target }]。 */
function collectBins() {
  const bins = [];
  for (const entry of readdirSync("packages")) {
    const manifestPath = path.join("packages", entry, "package.json");
    if (!existsSync(manifestPath)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const bin = manifest.bin;
    if (typeof bin !== "object" || bin === null) {
      continue;
    }
    for (const [cmd, target] of Object.entries(bin)) {
      bins.push({ cmd, target: path.join("packages", entry, String(target)) });
    }
  }
  return bins;
}

const bins = collectBins();
if (bins.length === 0) {
  console.log("无 CLI 包,跳过 ✓");
  process.exit(0);
}

let failures = 0;
let checked = 0;
let skipped = 0;

for (const { cmd, target } of bins) {
  if (!existsSync(target)) {
    console.log(`SKIP ${cmd}(dist 未构建: ${target})`);
    skipped += 1;
    continue;
  }
  checked += 1;
  const result = spawnSync(process.execPath, [target, "help"], {
    encoding: "utf8",
    timeout: 15000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const printedHelp = /usage|USAGE|命令|command|COMMAND/i.test(output);
  const crashed = /(at |\n\s*at )[\w.<>]+ \(/u.test(result.stderr ?? "");

  if (result.status !== 0 && !printedHelp) {
    console.error(`✗ ${cmd}: help 异常(exit ${result.status}),输出:\n${output.slice(0, 400)}`);
    failures += 1;
  } else if (crashed) {
    console.error(`✗ ${cmd}: 输出含异常堆栈:\n${output.slice(0, 400)}`);
    failures += 1;
  } else {
    console.log(`✓ ${cmd}: help 响应正常(${output.length} 字符, exit ${result.status})`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} 个 CLI 冒烟失败(检查 ${checked} 个,跳过 ${skipped} 个未构建)`);
  process.exit(1);
}
console.log(`\nCLI 冒烟通过(检查 ${checked} 个,跳过 ${skipped} 个未构建)✓`);
