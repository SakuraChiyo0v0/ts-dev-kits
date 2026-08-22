#!/usr/bin/env node
/**
 * 按依赖顺序发布全部 @amechan 包到 GitHub Packages。
 *
 * 前置条件:
 *   1. GitHub 组织 `amechan` 已创建,repo 已授权(见 docs/GITHUB_PACKAGES.md)。
 *   2. 用户目录 .npmrc 已配置发布凭证:
 *      //npm.pkg.github.com/:_authToken=<PAT>
 *
 * 用法:node scripts/publish-packages.mjs
 */
import { spawnSync } from "node:child_process";

// 依赖图单向无环,被依赖者先发布(pnpm 发布时会把 workspace:* 转为实际版本号)。
const ORDER = [
  "@sakurachiyo0v0/cli-utils",
  "@sakurachiyo0v0/bilibili-auth",
  "@sakurachiyo0v0/ffmpeg",
  "@sakurachiyo0v0/email",
  "@sakurachiyo0v0/bilibili",
  "@sakurachiyo0v0/chat-platforms",
];

let failed = false;
for (const pkg of ORDER) {
  console.log(`\n=== publishing ${pkg} ===`);
  const result = spawnSync("pnpm", ["--filter", pkg, "publish", "--no-git-checks"], {
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    console.error(`FAILED: ${pkg} (exit ${result.status ?? "signal"})`);
    failed = true;
    break;
  }
  console.log(`OK: ${pkg}`);
}

if (failed) {
  console.error("\n发布中止:存在失败包,已发布的包可重复发布(同版本需先删或 bump)。");
  process.exit(1);
}
console.log("\n全部发布完成 ✓");
