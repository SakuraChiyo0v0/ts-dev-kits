#!/usr/bin/env node
/**
 * scripts/check-package-bumps.mjs —— 版本 bump 守卫
 *
 * 检测「改了包的发布相关内容但没 bump package.json 版本号」的情况。
 * 按仓库约定，包根 tests/、docs/ 和 README.md 不单独触发发布；其余路径保守检查。
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
import { execFileSync } from "node:child_process";
import semver from "semver";

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error(`Git 检查失败: ${args[0]}；请确认基准、仓库和 index 有效`);
  }
}

const baseArg = process.argv[2];
// 先解析为提交哈希，再传给 diff，错误基准不能当作“没有改动”。
const base = git("rev-parse", "--verify", "--end-of-options", `${baseArg ?? "HEAD"}^{commit}`).trim();
const current = baseArg ? "HEAD" : "";
function pathsAt(ref) {
  return new Set((ref
    ? git("ls-tree", "-r", "--name-only", "-z", ref, "--", "packages/")
    : git("ls-files", "--cached", "-z", "--", "packages/")).split("\0").filter(Boolean));
}
const before = pathsAt(base);
const after = pathsAt(current);
function versionOf(pkg, ref, paths) {
  const prefix = `packages/${pkg}/`;
  const path = `${prefix}package.json`;
  if (!paths.has(path)) {
    if ([...paths].some(p => p.startsWith(prefix))) throw new Error(`${pkg}: 目录仍存在但缺少 package.json`);
    return undefined; // 整包新增/删除允许缺少对应侧的 manifest。
  }
  const manifest = JSON.parse(git("show", `${ref || ":0"}:${path}`));
  if (typeof manifest.version !== "string" || !semver.valid(manifest.version)) {
    throw new Error(`${pkg}: package.json 缺少合法语义化版本`);
  }
  return manifest.version;
}
const changedPaths = (baseArg
  ? git("diff", "--no-renames", "--name-only", "-z", `${base}...HEAD`, "--", "packages/")
  : git("diff", "--cached", "--no-renames", "--name-only", "-z", base, "--", "packages/")).split("\0");
const versionNow = p => versionOf(p, current, after);
const versionBase = p => versionOf(p, base, before);

const pkgs = [...new Set(
  changedPaths
    .map((l) => l.trim())
    .filter((l) => l.startsWith("packages/"))
    // 只排除包根的非发布目录，不放过 src/tests.ts、dist 或构建配置。
    .filter((l) => !/^packages\/[^/]+\/(?:tests\/|docs\/|README\.md$)/u.test(l))
    .map((l) => l.split("/")[1])
    .filter(Boolean),
)];

let fail = 0;
for (const p of pkgs) {
  const vNow = versionNow(p);
  const vBase = versionBase(p);
  if (vNow === undefined || vBase === undefined) continue; // 新包或 HEAD 无 manifest
  if (!semver.gt(vNow, vBase)) {
    console.error(`✖ 包 ${p} 的发布相关内容有改动,但版本号未递增(${vBase} -> ${vNow})`);
    fail = 1;
  } else {
    console.log(`✓ ${p}:${vBase} -> ${vNow}`);
  }
}

if (fail) {
  console.error("\n请先按语义化版本 bump 对应包的 version 后再提交;");
  console.error("仅包根 tests/、docs/ 和 README.md 改动自动豁免；混合源码或构建改动仍需 bump。");
  process.exit(1);
}
if (pkgs.length === 0) {
  console.log("无包发布相关改动,版本守卫通过 ✓");
}
