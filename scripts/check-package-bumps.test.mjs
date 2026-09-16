import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const guard = fileURLToPath(new URL("./check-package-bumps.mjs", import.meta.url));
const cases = [
  ["tests only", ["tests/client.test.ts"], true],
  ["test helpers", ["tests/helpers/server.ts"], true],
  ["docs only", ["docs/guide.md", "README.md"], true],
  ["source", ["src/index.ts"], false],
  ["mixed tests and source", ["tests/client.test.ts", "src/index.ts"], false],
  ["source file named tests", ["src/tests.ts"], false],
  ["build config", ["rollup.config.mjs"], false],
  ["tsconfig", ["tsconfig.build.json"], false],
  ["published output", ["dist/index.js"], false],
  ["manifest metadata", ["package.json"], false],
  ["source with version bump", ["src/index.ts"], true, "bump"],
  ["downgrade", ["src/index.ts"], false, "downgrade"],
  ["invalid manifest", [], false, "invalid-manifest"],
  ["manifest removed but source retained", [], false, "delete-manifest"],
  ["new package", [], true, "new-package"],
  ["whole package removed", [], true, "delete-package"],
  ["deleted test", [], true, "delete-test"],
  ["source moved into tests", [], false, "move-source"],
];

for (const mode of ["staged", "ci"]) {
  for (const [label, files, allowed, operation] of cases) {
    test(`${mode}: ${label}`, () => {
      // 保留临时 fixture 供失败复查；不触碰真实仓库的 index、分支或配置。
      const root = mkdtempSync(join(tmpdir(), "package-bump-guard-"));
      const git = (...args) => execFileSync("git", args, {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      const write = (path, text) => {
        const target = join(root, "packages/sample", path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, text);
      };
      const manifest = { name: "sample", version: "1.0.0" };
      git("init", "-q");
      git("config", "user.name", "SakuraChiyo");
      git("config", "user.email", "3296299414@qq.com");
      git("config", "core.hooksPath", "unused-hooks");
      write("package.json", JSON.stringify(manifest));
      write("src/index.ts", "export const value = 1;\n");
      write("tests/old.test.ts", "// existing test\n");
      git("add", "."); git("commit", "-qm", "fixture baseline");
      const base = git("rev-parse", "HEAD");
      for (const path of files) {
        write(path, path === "package.json"
          ? JSON.stringify({ ...manifest, description: "changed metadata" }) : "// changed\n");
      }
      if (operation === "bump") write("package.json", JSON.stringify({ ...manifest, version: "1.0.1" }));
      if (operation === "downgrade") write("package.json", JSON.stringify({ ...manifest, version: "0.9.0" }));
      if (operation === "invalid-manifest") write("package.json", "{broken");
      if (operation === "delete-manifest") unlinkSync(join(root, "packages/sample/package.json"));
      if (operation === "new-package") {
        mkdirSync(join(root, "packages/new"));
        writeFileSync(join(root, "packages/new/package.json"), JSON.stringify({ name: "new", version: "1.0.0" }));
      }
      if (operation === "delete-package") {
        for (const path of ["package.json", "src/index.ts", "tests/old.test.ts"]) unlinkSync(join(root, "packages/sample", path));
      }
      if (operation === "delete-test") unlinkSync(join(root, "packages/sample/tests/old.test.ts"));
      if (operation === "move-source") renameSync(
        join(root, "packages/sample/src/index.ts"), join(root, "packages/sample/tests/moved.ts"),
      );
      git("add", ".");
      if (mode === "ci") git("commit", "-qm", "fixture change");
      const result = spawnSync(process.execPath, [guard, ...(mode === "ci" ? [base] : [])], {
        cwd: root, encoding: "utf8",
      });
      assert.equal(result.status, allowed ? 0 : 1, `${result.stdout}\n${result.stderr}`);
    });
  }
}

test("invalid Git base and non-repository must fail", () => {
  const invalid = spawnSync(process.execPath, [guard, "nonexistent-review-base"], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Git 检查失败/);
  const root = mkdtempSync(join(tmpdir(), "not-a-repository-"));
  const outside = spawnSync(process.execPath, [guard], { cwd: root, encoding: "utf8" });
  assert.notEqual(outside.status, 0);
});
