#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { PACKAGES } from "./packages-list.mjs";
import { createRegistry, REGISTRY, runTool } from "./registry.mjs";

// 先查询全部精确版本；认证/网络错误发生时，不开始任何发布。
const registry = createRegistry();
const pending = [];
for (const [name, directory] of PACKAGES) {
  const { version } = JSON.parse(readFileSync(`${directory}/package.json`, "utf8"));
  if (registry.manifest(name, version)) console.log(`SKIP ${name}@${version} (already published)`);
  else pending.push({ name, version });
}
if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify({ publish: pending }, null, 2));
} else {
  for (const { name, version } of pending) {
    const result = runTool("pnpm", ["--filter", name, "publish", "--no-git-checks", "--registry", REGISTRY], { stdio: "inherit" });
    // 用新查询检查精确版本，不能把别人的 latest 当作本次发布成功。
    const published = createRegistry().manifest(name, version);
    if (!published) throw new Error(`${name}@${version} 发布后未查到目标版本 (exit ${result.status ?? "signal"})`);
    console.log(`OK: ${name}@${version}${result.status === 0 ? "" : " (concurrent publish verified)"}`);
  }
  console.log(`发布完成：${pending.length} 个包`);
}
