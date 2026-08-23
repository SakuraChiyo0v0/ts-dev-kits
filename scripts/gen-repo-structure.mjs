#!/usr/bin/env node
/**
 * scripts/gen-repo-structure.mjs
 *
 * 重新扫描仓库并重写 repo-structure.html(仓库结构总览页)的注入数据:
 *   1. 目录树 TREE_RAW     —— 从实际文件系统扫描(排除 .git / node_modules / dist / pnpm-lock.yaml)
 *   2. 包清单 PACKAGES     —— 读 packages 下各包的 package.json 的 name/version/dependencies
 *   3. 构建顺序 BUILD_ORDER—— 解析根 package.json 的 build 脚本里 --filter 顺序
 *   4. 依赖图 GRAPH        —— 按依赖深度自动分层布局(节点/边/列宽全部由脚本计算)
 *   5. 快照时间 GENERATED_AT
 *
 * 用法(仓库根目录):
 *   node scripts/gen-repo-structure.mjs
 *   pnpm gen:structure
 *   node scripts/gen-repo-structure.mjs --no-stamp   # 不更新页脚时间戳(CI 比对结构用)
 *
 * 维护提示:新增包的「描述文字 / 主题色」只需在本文件 DESCRIPTIONS / COLORS 里补一行;
 * 不补也有兜底默认值(通用描述 + 调色板取色),生成不会失败。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = join(ROOT, 'repo-structure.html');
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist']);
const EXCLUDE_FILES = new Set(['pnpm-lock.yaml']);

/* ---------- 1. 扫描目录树 ---------- */
const treeLines = [];
function walk(dir, indent) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => (e.isDirectory() ? !EXCLUDE_DIRS.has(e.name) : !EXCLUDE_FILES.has(e.name)))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  for (const e of entries) {
    treeLines.push(`${indent}${e.isDirectory() ? 'dir' : 'file'}|${e.name}`);
    if (e.isDirectory()) walk(join(dir, e.name), indent + '  ');
  }
}
walk(ROOT, '');
const treeRaw = treeLines.join('\r\n');

/* ---------- 2. 包元数据 ---------- */
const PKG_DIR = join(ROOT, 'packages');
/** 新增包时在此补一行描述(不补则用兜底文案)。 */
const DESCRIPTIONS = {
  'cli-utils': '各 SDK CLI 共享的解析 / 输出 / 错误工具,是多数包的公共底座。',
  'account': '跨平台账号认证底座:登录态存储、扫码登录骨架与公共错误模型,不感知具体平台。',
  'chat-platforms': '统一聊天平台接入 SDK:消息模型 + 适配器注册表,当前内置飞书适配器(WebSocket / Webhook)。',
  'lol': '英雄联盟 LCU 本地能力 SDK:召唤师 / 战绩 / 段位 / 对局流程 / 选人 / 游戏数据 / 事件订阅。',
  'email': '与供应商解耦的 Node.js 邮件 SDK:统一消息模型 + SMTP 适配器,错误消息脱敏。',
  'ffmpeg': 'FFmpeg / ffprobe 进程封装 + 视频 / 音频 / 图片处理高层函数,带进度回调。',
  'bilibili': 'B 站视频下载 SDK:链接解析、DASH 取流、可配置下载器、ffmpeg 合并,内置 WBI 签名。',
  'netease-music': '网易云音乐下载 SDK:自研 weapi 加密、二维码登录、权限感知品质、试听拦截硬规则。',
  'dsh-sdk-tools': 'DSH host 插件:把各功能包包装成 agent 工具,经 Agent 预设按需暴露,其余会话零污染。'
};
/** 新增包时可在 COLORS 里指定主题色,否则从 FALLBACK_COLORS 顺序取色。 */
const COLORS = {
  'cli-utils': '#38bdf8', 'account': '#fb923c',
  'chat-platforms': '#34d399', 'lol': '#a78bfa', 'email': '#f472b6',
  'ffmpeg': '#22d3ee', 'bilibili': '#60a5fa', 'netease-music': '#f87171',
  'dsh-sdk-tools': '#e879f9'
};
const FALLBACK_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#60a5fa', '#f87171', '#fb923c', '#e879f9'];

/**
 * 展示层覆盖表(0=基础层,1=SDK 层,2=领域 SDK,3=DSH 聚合)。
 * 自动分层按"内部依赖深度"计算;需要按语义归位时在此固定层号。
 * 例:lol 没有内部依赖(拓扑深度 0),但属于领域 SDK,固定到第 2 层。
 */
const LAYER_OVERRIDES = { 'lol': 2 };

const found = [];
for (const e of readdirSync(PKG_DIR, { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  let pj;
  try { pj = JSON.parse(readFileSync(join(PKG_DIR, e.name, 'package.json'), 'utf8')); } catch { continue; }
  const id = String(pj.name || '').replace(/^@sakurachiyo0v0\//, '');
  if (!id) continue;
  found.push({
    id,
    name: id,
    version: pj.version || '0.0.0',
    color: COLORS[id] || FALLBACK_COLORS[found.length % FALLBACK_COLORS.length],
    deps: Object.entries(pj.dependencies || {})
      .filter(([k]) => k.startsWith('@sakurachiyo0v0/'))
      .map(([k]) => k.replace(/^@sakurachiyo0v0\//, '')),
    desc: DESCRIPTIONS[id] || '待补充描述(在 scripts/gen-repo-structure.mjs 的 DESCRIPTIONS 中补充)。'
  });
}

/* ---------- 3. 构建顺序(解析根 build 脚本) ---------- */
const rootPj = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const buildOrder = [];
const buildScript = rootPj.scripts?.build || '';
const re = /pnpm --filter @sakurachiyo0v0\/([\w-]+) build/g;
let mm;
while ((mm = re.exec(buildScript))) buildOrder.push(mm[1]);
const seen = new Set(buildOrder);
// 未进 build 脚本的包按字母序补在末尾,保证列表完整
found.sort((a, b) => {
  const ia = seen.has(a.id) ? buildOrder.indexOf(a.id) : Infinity;
  const ib = seen.has(b.id) ? buildOrder.indexOf(b.id) : Infinity;
  if (ia !== ib) return ia - ib;
  return a.id.localeCompare(b.id);
});

/* ---------- 4. 依赖图自动分层布局 ---------- */
function buildGraphData(packages) {
  const idSet = new Set(packages.map((p) => p.id));
  const depth = {};
  const inProgress = new Set();
  const calc = (id) => {
    if (depth[id] !== undefined) return depth[id];
    if (inProgress.has(id)) return 0; // 防御环
    inProgress.add(id);
    const ds = packages.find((p) => p.id === id)?.deps.filter((d) => idSet.has(d)) || [];
    const fromDeps = ds.length ? 1 + Math.max(...ds.map(calc)) : 0;
    depth[id] = Math.max(LAYER_OVERRIDES[id] ?? -1, fromDeps);
    inProgress.delete(id);
    return depth[id];
  };
  packages.forEach((p) => calc(p.id));

  const maxD = Math.max(0, ...packages.map((p) => depth[p.id]));
  const X = (d) => 40 + d * 220;
  const W = 150, H = 44;
  const groups = {};
  packages.forEach((p) => (groups[depth[p.id]] = groups[depth[p.id]] || []).push(p.id));

  const nodes = [];
  Object.keys(groups).forEach((d) => {
    const list = groups[d];
    const n = list.length;
    list.forEach((id, i) => {
      const y = n === 1 ? (400 - H) / 2 : 56 + i * (270 / (n - 1));
      nodes.push({ id, x: X(Number(d)), y: Math.round(y), w: W });
    });
  });

  const edges = [];
  packages.forEach((p) => p.deps.forEach((d) => { if (idSet.has(d)) edges.push([d, p.id]); }));

  const layers = [];
  for (let d = 0; d <= maxD; d++) {
    if (!groups[d]?.length) continue;
    layers.push({ x: X(d) + W / 2, label: ['基础层', 'SDK 层', '领域 SDK', 'DSH 聚合'][d] || `L${d}` });
  }
  const width = Math.ceil((X(maxD) + W + 40) / 10) * 10;
  return { nodes, edges, layers, width };
}
const graphData = buildGraphData(found);

/* ---------- 5. 重写 HTML(全部使用稳定正则,可重复执行) ---------- */
let html = readFileSync(HTML_PATH, 'utf8');
const report = { tree: 0, pkg: 0, order: 0, graph: 0, stamp: 0 };
const noStamp = process.argv.includes('--no-stamp');

const replacements = [
  // 目录树(单行 JSON 字符串)
  [/const TREE_RAW = ".*";/, 'const TREE_RAW = ' + JSON.stringify(treeRaw) + ';', 'tree'],
  // 包清单(多行 JSON 数组,以行首 `];` 结尾)
  [/const PACKAGES = \[[\s\S]*?\n\];/, 'const PACKAGES = ' + JSON.stringify(found, null, 2) + ';', 'pkg'],
  // 构建顺序(单行 JSON 数组)
  [/const BUILD_ORDER = .*;/, 'const BUILD_ORDER = ' + JSON.stringify(buildOrder) + ';', 'order'],
  // 依赖图(单行 JSON 对象)
  [/const GRAPH = .*;/, 'const GRAPH = ' + JSON.stringify(graphData) + ';', 'graph']
];

if (!noStamp) {
  // 快照时间(HTML 文本节点)
  replacements.push([/(<code id="genAt">)[^<]*(<\/code>)/, '$1' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '$2', 'stamp']);
}

replacements.forEach(([rex, replacement, key]) => {
  if (!rex.test(html)) {
    console.warn(`  ! 未找到可替换的标记: ${rex}`);
    return;
  }
  html = html.replace(rex, replacement);
  report[key] = 1;
});

replacements.forEach(([rex, replacement, key]) => {
  if (!rex.test(html)) {
    console.warn(`  ! 未找到可替换的标记: ${rex}`);
    return;
  }
  html = html.replace(rex, replacement);
  report[key] = 1;
});

writeFileSync(HTML_PATH, html, 'utf8');
console.log(`repo-structure.html 已重新生成`);
console.log(`  packages=${found.length} · 目录条目=${treeLines.length} · buildOrder=${buildOrder.length} · 图节点=${graphData.nodes.length} / 边=${graphData.edges.length}`);
console.log(`  注入状态: tree=${report.tree} pkg=${report.pkg} order=${report.order} graph=${report.graph} stamp=${report.stamp}`);
