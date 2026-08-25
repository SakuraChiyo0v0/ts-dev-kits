#!/usr/bin/env node
/**
 * scripts/check-package-index.mjs —— packages-index 版本表与 package.json 同步守卫
 *
 * 维护 docs/packages-index.md 顶部的「包名 | 版本 | ...」表时,版本号容易漏改
 * (bump 包版本后忘记同步文档)。本脚本:
 *   - 默认(check):比对文档版本表与各包 package.json,不一致列出差异并退出 1;
 *   - --write:直接把文档版本号修正为 package.json 实际值(保留人工维护的描述列),
 *     并报告缺失行(包未进表)与多余行(包已删除但表内残留)。
 *
 * 用法:
 *   node scripts/check-package-index.mjs            # 只检查
 *   node scripts/check-package-index.mjs --write    # 修正版本号并检查缺/多行
 *
 * 退出码:0=一致(或 --write 已修正);1=有差异或缺失/多余行。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const DOC = "docs/packages-index.md";
const PACKAGES_DIR = "packages";

/** 读取 packages 各子包的 package.json,返回 { 包名: 版本 }。 */
function collectVersions() {
  const result = {};
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const manifestPath = path.join(PACKAGES_DIR, entry, "package.json");
    if (!existsSync(manifestPath)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const name = manifest.name;
    const version = manifest.version;
    if (typeof name === "string" && name.startsWith("@sakurachiyo0v0/") && typeof version === "string") {
      result[name] = version;
    }
  }
  return result;
}

/** 版本表行: | `@scope/pkg` | 1.2.3 | 描述... | */
const ROW_RE = /^(\| `(@sakurachiyo0v0\/[^`]+)` \| )([0-9][0-9.]*)( \|.*)$/u;

const versions = collectVersions();
const text = readFileSync(DOC, "utf8");
const lines = text.split(/\n/u);

const fixable = []; // { line, name, docVersion, realVersion }
const missingRows = []; // 包在 package.json 但文档表没有对应行
const staleRows = []; // 文档表有行但包已不存在

const docNames = new Set();
for (let i = 0; i < lines.length; i += 1) {
  const match = ROW_RE.exec(lines[i]);
  if (match === null) {
    continue;
  }
  const name = match[2];
  const docVersion = match[3];
  docNames.add(name);
  const realVersion = versions[name];
  if (realVersion === undefined) {
    staleRows.push({ line: i + 1, name });
  } else if (docVersion !== realVersion) {
    fixable.push({ line: i + 1, name, docVersion, realVersion });
  }
}

for (const name of Object.keys(versions)) {
  if (!docNames.has(name)) {
    missingRows.push({ name });
  }
}

if (process.argv.includes("--write")) {
  if (fixable.length > 0) {
    const nameToVersion = new Map(Object.entries(versions));
    const fixed = lines.map((line) => {
      const match = ROW_RE.exec(line);
      if (match === null) {
        return line;
      }
      const real = nameToVersion.get(match[2]);
      if (real === undefined || real === match[3]) {
        return line;
      }
      return `${match[1]}${real}${match[4]}`;
    });
    writeFileSync(DOC, fixed.join("\n"), "utf8");
    for (const item of fixable) {
      console.log(`修正 ${item.name}: ${item.docVersion} -> ${item.realVersion}(第 ${item.line} 行)`);
    }
    fixable.length = 0; // 已修正,不再计入失败
  }
} else {
  for (const item of fixable) {
    console.error(`✗ ${item.name}: 文档 ${item.docVersion} ≠ package.json ${item.realVersion}(第 ${item.line} 行)`);
  }
}

for (const item of missingRows) {
  console.error(`✗ ${item.name}: 已存在 package.json,但版本表缺少该包行`);
}
for (const item of staleRows) {
  console.error(`✗ 第 ${item.line} 行: ${item.name} 包已不存在,版本表残留`);
}

const ok = fixable.length === 0 && missingRows.length === 0 && staleRows.length === 0;
if (ok) {
  console.log("版本表与 package.json 一致 ✓");
}
process.exit(ok ? 0 : 1);
