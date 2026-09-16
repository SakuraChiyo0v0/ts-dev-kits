import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry, REGISTRY } from "./registry.mjs";
const representative = process.argv[2] === "--representative";
const readJson = path => JSON.parse(readFileSync(path, "utf8"));
const specs = representative ? ["email", "media-downloader", "bilibili"].map(name => {
  const m = readJson(new URL(`../packages/${name}/package.json`, import.meta.url));
  return `${m.name}@${m.version}`;
}) : process.argv.slice(2);
if (!specs.length) throw new Error("用法: pnpm verify:published @sakurachiyo0v0/<name>[@version] [...]");
const registry = createRegistry();
const manifests = specs.map(spec => {
  const match = /^(@sakurachiyo0v0\/[a-z0-9-]+)(?:@(.+))?$/u.exec(spec);
  if (!match) throw new Error(`非法包规格: ${spec}`);
  const m = registry.manifest(match[1], match[2]);
  if (!m) throw new Error(`目标版本未发布: ${spec}`);
  return m;
});
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("请通过 pnpm 脚本运行本验证器");
const work = mkdtempSync(join(tmpdir(), "ts-dev-consumer-"));
console.log(`消费验证目录: ${work}`);
const run = args => execFileSync(process.execPath, [pnpmCli, ...args], { cwd: work, stdio: "inherit", timeout: 300000 });
writeFileSync(join(work, "package.json"), JSON.stringify({ name: "published-consumer", private: true, type: "module" }));
// 只写 registry 映射；认证继承用户配置或 CI 环境，绝不复制凭据。
writeFileSync(join(work, ".npmrc"), `@sakurachiyo0v0:registry=${REGISTRY}\n`);
writeFileSync(join(work, "pnpm-workspace.yaml"), "packages:\n  - .\nallowBuilds:\n  better-sqlite3: true\n  esbuild: true\n  protobufjs: true\n  sharp: true\n");
run(["add", "--save-exact", ...manifests.map(m => `${m.name}@${m.version}`)]);
const tooling = name => readJson(new URL(`../node_modules/${name}/package.json`, import.meta.url)).version;
run(["add", "--save-dev", "--save-exact", `typescript@${tooling("typescript")}`, `@types/node@${tooling("@types/node")}`]);
for (const m of manifests) {
  const actual = readJson(join(work, "node_modules", ...m.name.split("/"), "package.json")).version;
  if (actual !== m.version) throw new Error(`${m.name}: 安装版本 ${actual} 不等于 ${m.version}`);
}
writeFileSync(join(work, "imports.mts"), manifests.map((m, i) => `import * as m${i} from ${JSON.stringify(m.name)}; console.log(${JSON.stringify(m.name)}, Object.keys(m${i}).length);`).join("\n"));
writeFileSync(join(work, "imports.cts"), manifests.map((m, i) => `import m${i} = require(${JSON.stringify(m.name)}); console.log(${JSON.stringify(m.name)}, Object.keys(m${i}).length);`).join("\n"));
if (representative) copyFileSync(new URL("./consumer-fixtures/smoke.mts", import.meta.url), join(work, "smoke.mts"));
writeFileSync(join(work, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: false, outDir: "dist", types: ["node"] }, include: ["*.mts", "*.cts"] }));
run(["exec", "tsc", "-p", "tsconfig.json"]);
for (const file of ["imports.mjs", "imports.cjs", ...(representative ? ["smoke.mjs"] : [])]) {
  execFileSync(process.execPath, [join("dist", file)], { cwd: work, stdio: "inherit", timeout: 60000 });
}
console.log(`PASS: ${manifests.map(m => `${m.name}@${m.version}`).join(", ")} (strict types + ESM + CJS${representative ? " + local API smoke" : ""})`);
