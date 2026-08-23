#!/usr/bin/env node
/**
 * scripts/verify-published-package.mjs —— 发布后消费验证
 *
 * 对发布到 GitHub Packages 的包,从全新临时项目安装并验证 ESM/CJS 双模式可导入,
 * 确保开箱即用(依赖从 GitHub Packages 正确解析)。
 *
 * 用法:
 *   pnpm verify:published @sakurachiyo0v0/bilibili
 *
 * 前置:用户目录 .npmrc 已配置 @sakurachiyo0v0:registry 与
 *       //npm.pkg.github.com/:_authToken(发布/消费 GitHub Packages 需要)。
 *
 * 退出码:0=通过;1=失败(安装或导入失败)。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pkgName = process.argv[2];
if (pkgName === undefined || !pkgName.startsWith("@sakurachiyo0v0/")) {
  console.error("用法: pnpm verify:published @sakurachiyo0v0/<name>");
  process.exit(1);
}

const shortName = pkgName.replace("@sakurachiyo0v0/", "");
const work = mkdtempSync(join(tmpdir(), `sakura-${shortName}-verify-`));
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) {
  console.error("请通过 pnpm 脚本运行本验证器");
  process.exit(1);
}

const runNpm = (args) => {
  execFileSync(process.execPath, [pnpmCli, ...args], {
    cwd: work,
    stdio: "inherit",
  });
};

// 全新临时项目,不继承仓库 node_modules,强制从 registry 解析。
writeFileSync(
  join(work, "package.json"),
  JSON.stringify(
    { name: `${shortName}-published-consumer`, private: true, type: "module" },
    null,
    2,
  ),
);

console.log(`\n=== 安装 ${pkgName}(GitHub Packages 最新版)===\n`);
runNpm(["add", pkgName]);

console.log("\n=== ESM 导入验证 ===\n");
writeFileSync(
  join(work, "esm.mjs"),
  `import * as mod from ${JSON.stringify(pkgName)};\n` +
    "console.log(`ESM OK: 导出 ${Object.keys(mod).length} 个符号:`, Object.keys(mod).slice(0, 8).join(\", \"));\n",
);
execFileSync(process.execPath, ["esm.mjs"], { cwd: work, stdio: "inherit" });

console.log("\n=== CJS require 验证 ===\n");
writeFileSync(
  join(work, "cjs.cjs"),
  `const mod = require(${JSON.stringify(pkgName)});\n` +
    `console.log("CJS OK: 导出", Object.keys(mod).length, "个符号");\n`,
);
execFileSync(process.execPath, ["cjs.cjs"], { cwd: work, stdio: "inherit" });

console.log(`\n✓ ${pkgName} 发布后消费验证通过(ESM + CJS)`);
