// 验证实际 tarball，消费目录和依赖均不链接 workspace。
// pnpm pack 会执行 prepare 并重建 dist；本命令必须在构建/测试结束后串行运行。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PACKAGES } from "./packages-list.mjs";
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("请运行 pnpm verify:config-packages");
const json = file => JSON.parse(readFileSync(file, "utf8"));
const manifests = new Map(PACKAGES.map(([name, dir]) => [name, { ...json(`${dir}/package.json`), dir: resolve(dir) }]));
const scope = name => `@sakurachiyo0v0/${name}`;
const platforms = ["account", "bilibili", "netease-music", "booth", "steam", "vrchat", "xiaoheihe"];
const groups = [
  { name: "local-auth", roots: platforms, absent: [scope("config"), scope("config-webdav"), scope("config-pg"), scope("webdav"), "pg", "better-sqlite3", "mysql2"], fixture: "local-auth.mts" },
  { name: "config-core", roots: ["config"], absent: [scope("webdav"), "webdav", "pg"], fixture: "config-core.mts" },
  { name: "webdav", roots: ["config", "config-webdav"], absent: ["pg", scope("config-pg")], fixture: "config-webdav.mts" },
  { name: "pg", roots: ["config", "config-pg"], absent: ["webdav", scope("webdav"), scope("config-webdav")], fixture: "config-pg.mts" },
];
const work = mkdtempSync(join(tmpdir(), "ts-dev-config-packages-"));
console.log(`消费验收目录: ${work}`);
const run = (args, cwd, capture = false) => execFileSync(process.execPath, [pnpm, ...args], {
  cwd, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", timeout: 300000,
  env: { ...process.env, npm_config_ignore_scripts: "true" },
});
const needed = new Set();
function collect(name) {
  if (needed.has(name)) return;
  const m = manifests.get(name); assert(m, `发布清单缺失 ${name}`); needed.add(name);
  for (const dep of Object.keys({ ...m.dependencies, ...m.optionalDependencies })) if (dep.startsWith("@sakurachiyo0v0/")) collect(dep);
}
groups.flatMap(g => g.roots).forEach(n => collect(scope(n)));
const overrides = {};
for (const name of needed) {
  const m = manifests.get(name); const tarball = join(work, `${name.split("/")[1]}-${m.version}.tgz`);
  run(["pack", "--out", tarball], m.dir, true);
  overrides[name] = `file:${tarball.replaceAll("\\", "/")}`;
}
const tooling = name => json(`node_modules/${name}/package.json`).version;
for (const group of groups) {
  const cwd = join(work, group.name); mkdirSync(cwd);
  const roots = group.roots.map(scope);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: `consumer-${group.name}`, private: true, type: "module", dependencies: Object.fromEntries(roots.map(n => [n, overrides[n]])), devDependencies: { typescript: tooling("typescript"), "@types/node": tooling("@types/node") } }));
  // JSON 是有效 YAML；覆写仅将同仓库包指向真实 tarball，不使用源码链接。
  writeFileSync(join(cwd, "pnpm-workspace.yaml"), JSON.stringify({ packages: ["."], overrides, allowBuilds: { sharp: true, esbuild: true, protobufjs: true } }));
  run(["install"], cwd);
  const tree = JSON.parse(run(["list", "--prod", "--depth", "Infinity", "--json"], cwd, true));
  const installed = new Set();
  function visit(node) { for (const [name, dep] of Object.entries({ ...node.dependencies, ...node.optionalDependencies })) { installed.add(name); visit(dep); } }
  tree.forEach(visit);
  for (const name of group.absent) assert(!installed.has(name), `${group.name} 不应安装 ${name}`);
  for (const name of roots) {
    const packed = json(join(cwd, "node_modules", ...name.split("/"), "package.json"));
    assert.equal(packed.version, manifests.get(name).version);
    // overrides 只替换来源，不应掩盖发布时 workspace 协议没有转换的问题。
    for (const [dependency, version] of Object.entries(packed.dependencies ?? {})) {
      if (dependency.startsWith("@sakurachiyo0v0/")) assert.equal(version, manifests.get(dependency).version);
    }
  }
  writeFileSync(join(cwd, "imports.mts"), roots.map((n, i) => `import * as m${i} from ${JSON.stringify(n)}; console.log(Object.keys(m${i}).length);`).join("\n"));
  writeFileSync(join(cwd, "imports.cts"), roots.map((n, i) => `import m${i} = require(${JSON.stringify(n)}); console.log(Object.keys(m${i}).length);`).join("\n"));
  copyFileSync(new URL(`./consumer-fixtures/${group.fixture}`, import.meta.url), join(cwd, "smoke.mts"));
  writeFileSync(join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: false, outDir: "dist", types: ["node"] }, include: ["*.mts", "*.cts"] }));
  run(["exec", "tsc", "-p", "tsconfig.json"], cwd);
  for (const script of ["imports.mjs", "imports.cjs", "smoke.mjs"]) execFileSync(process.execPath, [join("dist", script)], { cwd, stdio: "inherit", timeout: 60000 });
  console.log(`PASS ${group.name}: ${installed.size} 个运行依赖，隔离安装/类型/ESM/CJS/最小调用通过`);
}
