#!/usr/bin/env node
/**
 * scripts/check-package-bumps.mjs —— 版本 bump 守卫
 *
 * 检测「改了包内容(packages/**)但没 bump package.json 版本号」的情况。
 * 被依赖方先发布,版本号不变会被 CI 静默跳过 —— 这个守卫把坑堵在提交/合并前。
 *
 * 用法:
 *   本地 hook: node scripts/check-package-bumps.mjs
 *      比较「已暂存内容 vs HEAD」,版本取 index vs HEAD
 *   CI:        node scripts/check-package-bumps.mjs <base-ref>
 *      比较「<base-ref>...HEAD」,版本取 HEAD vs <base-ref>
 *
 * 退出码:0=通过;1=有包改了内容但版本未 bump(并打印提示)。
 * 新包(HEAD 无 manifest)不检查;跳过,不算失败。
 */
import { execSync } from "node:child_process";

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** 读取某个 git 对象(ref 形如 HEAD:path 或 :0:path)中 package.json 的 version */
function versionOf(ref) {
  const out = run(`git show "${ref}"`);
  if (!out) return undefined;
  try {
    return JSON.parse(out).version;
  } catch {
    return undefined;
  }
}

const baseArg = process.argv[2];

let changedPaths, versionNow, versionBase;
if (baseArg) {
  // CI:该提交/PR 相对 base 改动的 packages/ 文件
  changedPaths = run(`git diff --name-only ${baseArg}...HEAD -- packages/`).split("\n");
  versionNow = (p) => versionOf(`HEAD:packages/${p}/package.json`);
  versionBase = (p) => versionOf(`${baseArg}:packages/${p}/package.json`);
} else {
  // 本地 hook:本次提交将写入的内容(已暂存)vs HEAD
  changedPaths = run("git diff --cached --name-only HEAD -- packages/").split("\n");
  versionNow = (p) => versionOf(`:0:packages/${p}/package.json`);
  versionBase = (p) => versionOf(`HEAD:packages/${p}/package.json`);
}

const pkgs = [...new Set(
  changedPaths
    .map((l) => l.trim())
    .filter((l) => l.startsWith("packages/"))
    .map((l) => l.split("/")[1])
    .filter(Boolean),
)];

let fail = 0;
for (const p of pkgs) {
  const vNow = versionNow(p);
  const vBase = versionBase(p);
  if (vNow === undefined || vBase === undefined) continue; // 新包或 HEAD 无 manifest
  if (vNow === vBase) {
    console.error(`✖ 包 ${p} 的内容有改动,但版本号未 bump(${vNow})`);
    fail = 1;
  } else {
    console.log(`✓ ${p}:${vBase} -> ${vNow}`);
  }
}

if (fail) {
  console.error("\n请先按语义化版本 bump 对应包的 version 后再提交;");
  console.error("确认为非发布性改动(如仅测试/文档且不需发布)可用 git commit --no-verify 跳过。");
  process.exit(1);
}
if (pkgs.length === 0) {
  console.log("无包改动,版本守卫通过 ✓");
}
