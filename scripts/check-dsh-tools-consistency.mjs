#!/usr/bin/env node
/**
 * scripts/check-dsh-tools-consistency.mjs —— dsh-sdk-tools 功能清单一致性守卫
 *
 * 防止「加了一个功能包但漏了某处清单」的静默漂移。dsh-sdk-tools 里一个
 * 功能包出现在三处,必须同步:
 *   1. 工具注册开关:src/capabilities.ts 的 `config.<name>.enabled` 分支
 *   2. 设置页开关:src/client/settings-page.tsx 的 FEATURES `key: "<name>"`
 *   3. 预设配置:presets/ts-dev-kits/agent.cordis.yml 顶层 `<name>:` 行
 * 以及 host 侧 settings 文档(src/settings.ts 的 SettingsShapeInput/SettingsSchema)。
 *
 * 三处清单不一致 → exit 1 阻止提交;一致 → 通过。
 *
 * 用法:
 *   本地 hook / 手动: node scripts/check-dsh-tools-consistency.mjs
 *
 * 退出码:0=通过;1=清单不一致(打印差异)。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PKG = join(ROOT, "packages/dsh-sdk-tools");

let failed = false;

/** 从 capabilities.ts 提取已注册的功能名:config.<name>.enabled。 */
function registeredNames() {
  const src = readFileSync(join(PKG, "src/capabilities.ts"), "utf-8");
  const names = new Set();
  const re = /config\.([a-z][a-z0-9]*)\.enabled/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    names.add(m[1]);
  }
  return names;
}

/** 从 settings-page.tsx 提取设置页 FEATURES 的 key。 */
function settingsPageNames() {
  const src = readFileSync(join(PKG, "src/client/settings-page.tsx"), "utf-8");
  const names = new Set();
  const re = /key:\s*"([a-z][a-z0-9]*)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    names.add(m[1]);
  }
  return names;
}

/** 从 agent.cordis.yml 提取预设顶层 config 键(功能名)。 */
function presetNames() {
  const yml = readFileSync(join(PKG, "presets/ts-dev-kits/agent.cordis.yml"), "utf-8");
  const names = new Set();
  // 顶层 config 下的键:形如 `    bilibili:`(4 空格缩进,后接冒号,非注释)。
  for (const line of yml.split("\n")) {
    const m = /^    ([a-z][a-z0-9]*):\s*(#.*)?$/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

/** 从 settings.ts 提取 host settings 文档开关名。 */
function settingsDocNames() {
  const src = readFileSync(join(PKG, "src/settings.ts"), "utf-8");
  const names = new Set();
  const re = /^  ([a-z][a-z0-9]*)\??:\s?boolean;/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    names.add(m[1]);
  }
  return names;
}

function diff(label, base, other) {
  const missing = [...base].filter((n) => !other.has(n));
  const extra = [...other].filter((n) => !base.has(n));
  if (missing.length > 0 || extra.length > 0) {
    failed = true;
    console.error(`✖ ${label} 不一致:`);
    if (missing.length > 0) console.error(`   缺失: ${missing.join(", ")}`);
    if (extra.length > 0) console.error(`   多余: ${extra.join(", ")}`);
  }
}

const registered = registeredNames();
const settingsPage = settingsPageNames();
const preset = presetNames();
const settingsDoc = settingsDocNames();

diff("工具注册 ↔ 设置页", registered, settingsPage);
diff("工具注册 ↔ 预设", registered, preset);
diff("工具注册 ↔ settings 文档", registered, settingsDoc);

if (failed) {
  console.error(
    "\ndsh-sdk-tools 功能清单不同步:新增/移除功能包时,需同步 capabilities.ts、\n" +
      "settings-page.tsx(FEATURES + SettingsShape)、agent.cordis.yml、settings.ts 四处。",
  );
  process.exit(1);
}

console.log(
  `✓ dsh-sdk-tools 功能清单一致(${registered.size} 个包:${[...registered].sort().join(", ")})`,
);
