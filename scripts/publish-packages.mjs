#!/usr/bin/env node
/**
 * 按依赖顺序发布版本有变化的 @sakurachiyo0v0 包到 GitHub Packages。
 *
 * 行为:
 *   - 已发布过且版本相同 → 跳过(可重复安全执行,本地/CI 通用)
 *   - 本地 version 与已发布版本不同 → 发布
 *   - 按依赖图单向顺序(cli-utils → bilibili-auth → ffmpeg → email → account → lol → netease-music → bilibili → chat-platforms → dsh-sdk-tools)
 *
 * 前置:用户目录 .npmrc 已配置 //npm.pkg.github.com/:_authToken(或 CI 注入 NODE_AUTH_TOKEN)。
 *
 * 用法:node scripts/publish-packages.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REGISTRY = "https://npm.pkg.github.com/";
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

// [包名, 目录] —— 依赖图单向无环,被依赖者先发布。
const PACKAGES = [
  ["@sakurachiyo0v0/cli-utils", "packages/cli-utils"],
  ["@sakurachiyo0v0/bilibili-auth", "packages/bilibili-auth"],
  ["@sakurachiyo0v0/ffmpeg", "packages/ffmpeg"],
  ["@sakurachiyo0v0/email", "packages/email"],
  ["@sakurachiyo0v0/account", "packages/account"],
  ["@sakurachiyo0v0/lol", "packages/lol"],
  ["@sakurachiyo0v0/netease-music", "packages/netease-music"],
  ["@sakurachiyo0v0/bilibili", "packages/bilibili"],
  ["@sakurachiyo0v0/chat-platforms", "packages/chat-platforms"],
  ["@sakurachiyo0v0/dsh-sdk-tools", "packages/dsh-sdk-tools"],
];

/** 查询包在 registry 上已发布的版本;未发布返回 undefined。 */
function publishedVersion(name) {
  const result = spawnSync(
    NPM,
    ["view", name, "version", "--registry", REGISTRY],
    { encoding: "utf8", shell: true },
  );
  if (result.status !== 0) {
    return undefined; // 404:从未发布
  }
  const lines = result.stdout.trim().split(/\r?\n/u);
  return lines[lines.length - 1]?.trim() || undefined;
}

let published = 0;
for (const [name, directory] of PACKAGES) {
  const manifest = JSON.parse(readFileSync(`${directory}/package.json`, "utf8"));
  const local = manifest.version;
  const remote = publishedVersion(name);

  if (remote === local) {
    console.log(`SKIP ${name}@${local} (already published)`);
    continue;
  }

  console.log(`\n=== publishing ${name}@${local} (remote: ${remote ?? "none"}) ===`);
  const result = spawnSync("pnpm", ["--filter", name, "publish", "--no-git-checks"], {
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    console.error(`FAILED: ${name} (exit ${result.status ?? "signal"})`);
    process.exit(result.status ?? 1);
  }
  console.log(`OK: ${name}`);
  published += 1;
}

if (published === 0) {
  console.log("\n无版本变化,全部跳过 ✓");
} else {
  console.log(`\n发布完成:${published} 个包 ✓`);
}
