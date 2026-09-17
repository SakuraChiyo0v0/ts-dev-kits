import assert from "node:assert/strict";
import test from "node:test";
import { assertPackageLayer, PACKAGE_GROUPS } from "./package-groups.mjs";
import { PACKAGES } from "./packages-list.mjs";
const name = p => `@sakurachiyo0v0/${p}`;
const manifest = (from, to, field = "dependencies") => ({ name: name(from), [field]: { [name(to)]: "workspace:*" } });
test("分类完整且无重复", () => {
  const classified = PACKAGE_GROUPS.flatMap(g => g.packages.map(name));
  assert.equal(new Set(classified).size, classified.length);
  assert.deepEqual(classified.sort(), PACKAGES.map(([n]) => n).sort());
});
for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  test(`${field}: 阻止核心反向依赖和平台互相依赖`, () => {
    for (const [from, to] of [["logger", "cli-utils"], ["config", "config-pg"], ["account", "config"], ["config-webdav", "config-pg"], ["ffmpeg", "bilibili"], ["database", "steam"], ["steam", "bilibili"], ["config", "config"]]) {
      assert.throws(() => assertPackageLayer(manifest(from, to, field)), /依赖方向越界/);
    }
  });
}
test("允许实际的基础、适配器和平台组合", () => {
  for (const [from, to] of [["cli-utils", "logger"], ["config", "logger"], ["config-pg", "config"], ["config-webdav", "webdav"], ["database", "config-webdav"], ["media-downloader", "ffmpeg"], ["bilibili", "account"], ["kazumi", "config-webdav"]]) {
    assert.doesNotThrow(() => assertPackageLayer(manifest(from, to)));
  }
});
test("开发集成测试允许跨层，外部依赖交由各包消费验收", () => {
  assert.doesNotThrow(() => assertPackageLayer(manifest("account", "config-webdav", "devDependencies")));
  assert.doesNotThrow(() => assertPackageLayer({ name: name("config-pg"), dependencies: { pg: "^8" } }));
});
test("未分类包或内部依赖不能静默放行", () => {
  assert.throws(() => assertPackageLayer(manifest("unknown", "logger")), /未分类/);
  assert.throws(() => assertPackageLayer(manifest("steam", "unknown")), /未分类/);
});
