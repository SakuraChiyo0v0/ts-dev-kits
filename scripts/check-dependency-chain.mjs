#!/usr/bin/env node
/**
 * 发布前依赖链完整性检查 —— 堵住「workspace:* 替换后引用不存在版本」的坑。
 *
 * 背景(2026-08 踩坑):publish 时 `workspace:*` 会被替换成「发布时刻的本地版本」。
 * 若 A 依赖 B,而 B 的新版本本次不发布(或发布顺序在 A 之后),则 A 发布后
 * 引用 registry 上不存在的 B 版本 → 消费者安装断链(曾因 logger 从未发布,
 * 连锁导致 15+ 包版本重发)。
 *
 * 本脚本模拟发布后的依赖图并验证:
 *   1. 每个 @sakurachiyo0v0/* 依赖的目标版本在发布顺序上「先于或等于」依赖方;
 *   2. 不被本次发布的依赖版本,必须已存在于 registry(递归检查已发布版本)。
 *
 * 用法(需 GitHub Packages 读权限):
 *   GH_PACKAGES_TOKEN=<token> node scripts/check-dependency-chain.mjs
 *   无 token 时跳过 registry 检查,仅做本地顺序校验(CI 里必须带 token)。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGES } from "./packages-list.mjs";

const REGISTRY = "https://npm.pkg.github.com/";
const SCOPE = "@sakurachiyo0v0";
const token = process.env.GH_PACKAGES_TOKEN ?? process.env.NODE_AUTH_TOKEN;

/** 读取包本地 manifest。 */
function localManifest(dir) {
  return JSON.parse(readFileSync(join(process.cwd(), dir, "package.json"), "utf8"));
}

/** 依赖声明 → 期望版本(workspace:* → 本地当前版本;workspace:^x → ^x;普通 → 原样)。 */
function resolveDependencySpec(spec, localVersion) {
  if (spec === "workspace:*" || spec === "workspace:^" || spec === "workspace:~") {
    return localVersion; // pnpm 发布时替换为精确本地版本
  }
  const m = /^workspace:(.+)$/u.exec(spec);
  if (m !== null) {
    return m[1];
  }
  return spec;
}

/** 判断 semver 范围是否匹配版本(精确 / ^x.y.z / ~x.y.z / >=a <b 区间)。 */
function matchesRange(range, version) {
  if (range === version) return true;
  if (range.startsWith("^")) {
    const base = range.slice(1).split(".").slice(0, 2).join(".");
    return version.startsWith(`${base}.`);
  }
  if (range.startsWith("~")) {
    const base = range.slice(1).split(".").slice(0, 2).join(".");
    return version.startsWith(`${base}.`);
  }
  // 区间:>=a <b(含 <x.y.z-0 的预发布排除)
  const m = />=\s*([\d.]+)\s*<\s*([\d.]+)/u.exec(range);
  if (m !== null && m[1] !== undefined && m[2] !== undefined) {
    const lower = m[1];
    const upper = m[2];
    return compareVersions(version, lower) >= 0 && compareVersions(version, upper) < 0;
  }
  // 其它写法(如 >=a)或无法解析:精确语义下视为不匹配,避免漏检。
  return false;
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 查询包在 registry 的已发布版本集合(递归缓存)。 */
const publishedCache = new Map();
async function publishedVersions(pkg) {
  if (publishedCache.has(pkg)) return publishedCache.get(pkg);
  const versions = new Set();
  try {
    const resp = await fetch(`${REGISTRY}${pkg.replace("/", "%2f")}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (resp.status === 404) {
      // 从未发布(新包首次发布前的正常状态):视为空版本集,
      // 由调用方按"本次会发布"逻辑处理。
      publishedCache.set(pkg, versions);
      return versions;
    }
    if (!resp.ok) {
      // 401/403/5xx = 凭据或环境问题,无法验证依赖链,必须显式失败。
      throw new Error(`registry 返回 ${resp.status}`);
    }
    const data = await resp.json();
    for (const v of Object.keys(data.versions ?? {})) {
      versions.add(v);
    }
  } catch (error) {
    // 拿不到已发布版本 = 无法验证依赖链,必须显式失败(防止误判为"本次会发布")。
    console.error(`✖ 无法查询 ${pkg} 的已发布版本:${error.message}(需 GH_PACKAGES_TOKEN)`);
    process.exit(1);
  }
  publishedCache.set(pkg, versions);
  return versions;
}

let errors = 0;

/** 检查单包的依赖链(含传递依赖)。 */
async function checkPackage(pkgName, dir, localVersion, publishOrder) {
  const manifest = localManifest(dir);
  const deps = manifest.dependencies ?? {};
  const publishIndex = publishOrder.indexOf(pkgName);

  for (const [depName, spec] of Object.entries(deps)) {
    if (!depName.startsWith(`${SCOPE}/`)) continue;
    const depLocalVersion = localManifest(PACKAGES.find(([n]) => n === depName)?.[1] ?? "missing").version ?? "?";
    const expected = resolveDependencySpec(spec, depLocalVersion);
    const depPublishIndex = publishOrder.indexOf(depName);

    // 1. 本地顺序:被依赖包必须在本包之前(或同一次发布)。
    if (depPublishIndex !== -1 && publishIndex !== -1 && depPublishIndex > publishIndex) {
      console.error(`✖ ${pkgName}@${localVersion} 依赖 ${depName}@${expected},但发布顺序在其后(应先发布被依赖者)`);
      errors += 1;
      continue;
    }

    // 2. 版本存在性:被依赖版本必须「已存在于 registry」或「本次确实会发布(本地版本未发布过)」。
    const depVersions = await publishedVersions(depName);
    const willPublishThisTime = depPublishIndex !== -1 && !depVersions.has(depLocalVersion);
    if (willPublishThisTime && depPublishIndex < publishIndex) {
      // 被依赖者本次会发布新版本,且顺序在依赖方之前:模拟发布后存在。
      continue;
    }
    const exists = [...depVersions].some((v) => matchesRange(expected, v));
    if (!exists) {
      console.error(`✖ ${pkgName}@${localVersion} 依赖 ${depName}@${expected},registry 上不存在(已发布:${[...depVersions].join(",") || "无"})`);
      errors += 1;
    }
  }
}

async function main() {
  const publishOrder = PACKAGES.map(([name]) => name);

  // 1. 本地顺序 + 本次发布包的存在性
  for (const [name, dir] of PACKAGES) {
    const manifest = localManifest(dir);
    await checkPackage(name, dir, manifest.version, publishOrder);
  }

  // 2. 已发布版本的传递依赖完整性(递归一层:查所有已发布版本的依赖是否存在)
  for (const [name, dir] of PACKAGES) {
    const manifest = localManifest(dir);
    const versions = await publishedVersions(name);
    if (versions.size === 0) continue;
    const latest = manifest.version;
    if (!versions.has(latest)) continue; // 本次要发布新版本,旧版本已检查过
    // 已发布最新版本若与本地一致(无新发布),检查其依赖
    const deps = manifest.dependencies ?? {};
    for (const [depName, spec] of Object.entries(deps)) {
      if (!depName.startsWith(`${SCOPE}/`)) continue;
      const depVersions = await publishedVersions(depName);
      const exists = [...depVersions].some((v) => matchesRange(resolveDependencySpec(spec, localManifest(PACKAGES.find(([n]) => n === depName)?.[1] ?? "missing").version), v));
      if (!exists) {
        console.error(`✖ 已发布 ${name}@${latest} 依赖 ${depName}@${spec},registry 上不存在`);
        errors += 1;
      }
    }
  }

  if (errors > 0) {
    console.error(`\n依赖链检查失败:${errors} 处断链。请先发布被依赖包或修正版本。`);
    process.exit(1);
  }
  console.log("✓ 依赖链完整:所有 workspace 依赖在发布顺序与 registry 版本上均可达");
}

main().catch((error) => {
  console.error("检查脚本执行失败:", error);
  process.exit(1);
});
