#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { PACKAGE_GROUPS, assertPackageLayer } from "./package-groups.mjs";
import { PACKAGES } from "./packages-list.mjs";

// 防止应用回流、发布漏包以及依赖顺序错误；不代替代码审查。
assert(!existsSync("apps"), "成熟应用应维护在独立仓库，不进入工具库 apps/");
assert(!existsSync("packages/dsh-sdk-tools"), "宿主专用适配包不进入工具库");
const directories = readdirSync("packages", { withFileTypes: true })
  .filter(e => e.isDirectory()).map(e => `packages/${e.name}`).sort();
assert.deepEqual(PACKAGES.map(([, directory]) => directory).sort(), directories,
  "packages/ 与发布清单必须一一对应");
const classified = PACKAGE_GROUPS.flatMap(g => g.packages.map(p => `@sakurachiyo0v0/${p}`));
assert.equal(new Set(classified).size, classified.length, "工具包分类不可重复");
assert.deepEqual([...classified].sort(), PACKAGES.map(([name]) => name).sort(), "分类必须覆盖全部发布包");
const published = new Set();
for (const [name, directory] of PACKAGES) {
  const manifest = JSON.parse(readFileSync(`${directory}/package.json`, "utf8"));
  assert.equal(manifest.name, name);
  assertPackageLayer(manifest);
  assert(!published.has(name), `重复发布包: ${name}`);
  assert(!manifest.private, `${name} 必须可发布`);
  assert(manifest.exports && manifest.types, `${name} 必须提供公开导出和类型`);
  assert(manifest.scripts?.build && manifest.scripts?.test && manifest.scripts?.typecheck,
    `${name} 必须提供 build/test/typecheck`);
  for (const [dependency, version] of Object.entries({
    ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies,
  })) {
    assert(!dependency.startsWith("@deepseek-ai/"), `${name} 不应依赖 DSH 宿主`);
    assert(!/^(file:|link:)/u.test(version), `${name} 不应依赖本机路径 ${dependency}`);
    if (dependency.startsWith("@sakurachiyo0v0/")) {
      assert(published.has(dependency), `${name} 的依赖 ${dependency} 必须先发布`);
    }
  }
  published.add(name);
}
console.log(`工具库边界通过：${published.size} 个包，分类与发布清单完整、依赖方向和顺序正确`);
