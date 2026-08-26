#!/usr/bin/env node
/**
 * scripts/gen-repo-structure.mjs
 *
 * 重新扫描仓库并重写 repo-structure.html(仓库结构总览页)的注入数据:
 *   1. 目录树 TREE_RAW     —— 从实际文件系统扫描(排除 .git / node_modules / dist / pnpm-lock.yaml)
 *   2. 包清单 PACKAGES     —— 读 packages 下各包的 package.json 的 name/version/dependencies
 *   3. 构建顺序 BUILD_ORDER—— 解析根 package.json 的 build 脚本里 --filter 顺序
 *   4. 快照时间 GENERATED_AT
 *
 * 依赖图(节点/边/分层/域分组)由 HTML 端 JS 根据 PACKAGES 自算布局,本脚本不注入坐标。
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
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist', 'lib']);
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
  'dsh-sdk-tools': 'DSH host 插件:把各功能包包装成 agent 工具,经 Agent 预设按需暴露,其余会话零污染。',
  'steam': 'Steam SDK(查询向):Web API / Storefront / Community 三套接口,登录态支持,零写操作。',
  'logger': '轻量级日志模块:级别控制、命名空间、多机来源标识、子 logger 派生、可替换 transport,全仓公共底座。',
  'webdav': 'WebDAV 配置存取 SDK:基础文件操作 + 配置文件存储高层 API(原子写 + 自动备份),带 CLI,适合多端同步的轻量配置场景。',
  'config': '配置中心 SDK:全局只配置一次,各 SDK/平台经 namespace 隔离存取,按域决定是否加密(敏感配置加密上云,普通配置明文)。',
  'chuanshengtong': '传声筒:输入文字 + 内置图像模板,程序化合成输出图片(不依赖 AI 图像 API),CLI 与 SDK 双形态。',
  'booth': 'BOOTH(booth.pm,Pixiv 旗下数字商品市场)SDK:登录态管理、商品解析、免费领取 / 付费加购、文件下载与批量编排。',
  'vrchat': 'VRChat 官方 REST API SDK:认证(密码 + 2FA)、用户、世界、头像、实例、好友、通知等能力,基于 account 密码登录骨架。',
  'xiaoheihe': '小黑盒(xiaoheihe.cn)SDK:扫码登录 + hkey/nonce 签名 + 只读查询(帖子/评论/feed/@消息/用户),协议层提炼自 Go 参考实现。',
  'database': '统一数据访问抽象层:一套 async API 同时访问本地 SQLite 与远程 PostgreSQL / MySQL,切换后端只改一行配置。'
};
/** 新增包时可在 COLORS 里指定主题色,否则从 FALLBACK_COLORS 顺序取色。 */
const COLORS = {
  'cli-utils': '#38bdf8', 'account': '#fb923c',
  'chat-platforms': '#34d399', 'lol': '#a78bfa', 'email': '#f472b6',
  'ffmpeg': '#22d3ee', 'bilibili': '#60a5fa', 'netease-music': '#f87171',
  'dsh-sdk-tools': '#e879f9', 'steam': '#94a3b8'
};
const FALLBACK_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#60a5fa', '#f87171', '#fb923c', '#e879f9'];

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

/* ---------- 5. 重写 HTML(全部使用稳定正则,可重复执行) ---------- */
let html = readFileSync(HTML_PATH, 'utf8');
const report = { tree: 0, pkg: 0, order: 0, stamp: 0 };
const noStamp = process.argv.includes('--no-stamp');

const replacements = [
  // 目录树(单行 JSON 字符串)
  [/const TREE_RAW = ".*";/, 'const TREE_RAW = ' + JSON.stringify(treeRaw) + ';', 'tree'],
  // 包清单(多行 JSON 数组,以行首 `];` 结尾)
  [/const PACKAGES = \[[\s\S]*?\n\];/, 'const PACKAGES = ' + JSON.stringify(found, null, 2) + ';', 'pkg'],
  // 构建顺序(单行 JSON 数组)
  [/const BUILD_ORDER = .*;/, 'const BUILD_ORDER = ' + JSON.stringify(buildOrder) + ';', 'order']
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
console.log(`  packages=${found.length} · 目录条目=${treeLines.length} · buildOrder=${buildOrder.length}`);
console.log(`  注入状态: tree=${report.tree} pkg=${report.pkg} order=${report.order} stamp=${report.stamp}`);
