import assert from "node:assert/strict";
import test from "node:test";
import { createRegistry, decodeRegistryResult, runTool } from "./registry.mjs";
import { checkDependencyPlan, resolveWorkspace } from "./dependency-plan.mjs";
const name = short => `@sakurachiyo0v0/${short}`;
const manifest = (short, version = "1.0.0", dependencies = {}) => ({ name: name(short), version, dependencies });
const registry = items => ({
  manifest: (n, v) => items.find(m => m.name === n && m.version === v) ?? null,
  versions: n => items.filter(m => m.name === n).map(m => m.version),
});
for (const code of ["E401", "E403", "E500", "ETIMEDOUT", "ENOTFOUND"]) {
  test(`registry fails closed: ${code}`, () => assert.throws(() => decodeRegistryResult({ status: 1, stdout: JSON.stringify({ error: { code } }) }, "test"), new RegExp(code)));
}
test("only confirmed E404 is absent", () => {
  assert.equal(decodeRegistryResult({ status: 1, stdout: '{"error":{"code":"E404"}}' }, "test"), null);
  for (const result of [{ status: 1, stdout: "" }, { status: 0, stdout: "bad json" }, { status: null, error: new Error("ENOENT") }]) assert.throws(() => decodeRegistryResult(result, "test"));
});
test("exact version query, mismatch and cache", () => {
  let calls = 0;
  const r = createRegistry((cmd, args) => { calls++; assert.equal(args[1], `${name("a")}@1.0.0`); return { status: 0, stdout: JSON.stringify(manifest("a")) }; });
  r.manifest(name("a"), "1.0.0"); r.manifest(name("a"), "1.0.0"); assert.equal(calls, 1);
  assert.throws(() => createRegistry(() => ({ status: 0, stdout: JSON.stringify(manifest("a", "2.0.0")) })).manifest(name("a"), "1.0.0"));
});
test("workspace protocols convert to published ranges", () => {
  assert.equal(resolveWorkspace("workspace:*", "1.2.3"), "1.2.3");
  assert.equal(resolveWorkspace("workspace:^", "1.2.3"), "^1.2.3");
  assert.equal(resolveWorkspace("workspace:~", "1.2.3"), "~1.2.3");
  assert.throws(() => resolveWorkspace("workspace:*"));
});
test("published manifests override local imagined dependencies", () => {
  assert.throws(() => checkDependencyPlan([manifest("a")], registry([manifest("a", "1.0.0", { [name("missing")]: "^1.0.0" })])), /无已发布/);
});
test("nested published dependencies are checked", () => {
  const a = manifest("a", "1.0.0", { [name("b")]: "^1.0.0" });
  assert.throws(() => checkDependencyPlan([a], registry([a, manifest("b", "1.2.0", { [name("c")]: "1.0.0" })])), /无已发布/);
});
test("standard semver ranges select existing releases", () => {
  const a = manifest("a", "1.0.0", { [name("b")]: ">=1.2.0 <2 || ^3.0.0" });
  assert.equal(checkDependencyPlan([a], registry([a, manifest("b", "3.1.0")])).checked, 2);
});
test("new dependencies must be published first", () => {
  const a = manifest("a", "1.0.0", { [name("b")]: "workspace:*" }); const b = manifest("b");
  assert.equal(checkDependencyPlan([b, a], registry([])).pending.length, 2);
  assert.throws(() => checkDependencyPlan([a, b], registry([])), /无已发布/);
});
test("npm command executes on current platform", () => {
  const result = runTool("npm", ["--version"], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0); assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});
test("higher published version cannot be hidden by a lower planned version", () => {
  const b = manifest("b");
  const a = manifest("a", "1.0.0", { [name("b")]: "workspace:^" });
  const broken = manifest("b", "1.1.0", { [name("missing")]: "*" });
  assert.throws(() => checkDependencyPlan([b, a], registry([broken])), /无已发布/);
});
