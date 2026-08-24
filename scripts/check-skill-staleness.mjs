#!/usr/bin/env node
/**
 * scripts/check-skill-staleness.mjs —— CLI skill 同步守卫
 *
 * 防止 skills 目录下的 SKILL.md 静默过期:CLI 演进(新增/改名/删除命令、改登录方式)
 * 后 skill 没同步,AI 会按旧手册操作报错。
 *
 * 两层校验:
 *   第 1 层(阻止):对比 CLI 源码 COMMANDS 常量(含子命令数组)与 SKILL.md 中
 *                 反引号命令调用。命令不一致 → exit 1 阻止提交。
 *   第 2 层(警告):CLI 源码文件 mtime > SKILL.md mtime 时提示"CLI 已改但 skill
 *                 可能未同步",提醒人工检查参数/语义/文档表(命令名不变时扫描不到)。
 *
 * 用法:
 *   本地 hook / 手动: node scripts/check-skill-staleness.mjs
 *   全量检查:         node scripts/check-skill-staleness.mjs --all
 *
 * 退出码:0=通过;1=第 1 层发现命令不一致(阻止)。
 * 脚本自身解析失败不阻止(宁可漏检,不误伤)。
 */
import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** skill 目录名 → CLI 源码相对路径 + bin 名。 */
const SKILL_MAP = [
  {
    skill: "bilibili-cli",
    cli: "packages/bilibili/src/cli/bilibili.ts",
    bin: "amechan-bilibili",
  },
  {
    skill: "email-cli",
    cli: "packages/email/src/cli/email.ts",
    bin: "amechan-email",
  },
  {
    skill: "ffmpeg-cli",
    cli: "packages/ffmpeg/src/cli/ffmpeg.ts",
    bin: "amechan-ffmpeg",
  },
  {
    skill: "vrchat-cli",
    cli: "packages/vrchat/src/cli/vrchat.ts",
    bin: "amechan-vrchat",
  },
  {
    skill: "booth-cli",
    cli: "packages/booth/src/cli/booth.ts",
    bin: "amechan-booth",
  },
  {
    skill: "steam-cli",
    cli: "packages/steam/src/cli/steam.ts",
    bin: "amechan-steam",
  },
  {
    skill: "xiaoheihe-cli",
    cli: "packages/xiaoheihe/src/cli/xiaoheihe.ts",
    bin: "amechan-xiaoheihe",
  },
];

/**
 * 从 CLI 源码提取命令结构:
 *   - 顶层命令:const COMMANDS = [...] 里的 name
 *   - 子命令:const FAV_COMMANDS / RELATION_COMMANDS / TAG_COMMANDS 等里的 name,
 *     父命令 = 数组变量名前缀小写(fav/relation/tag)。
 * 返回 { top: Set<string>, subs: Map<string, Set<string>> }。
 */
function extractCliCommands(source) {
  const top = new Set();
  const subs = new Map();
  const arrayRe = /const\s+(\w+)\s*=\s*\[([\s\S]*?)\];/g;
  let match;
  while ((match = arrayRe.exec(source)) !== null) {
    const varName = match[1];
    const isTop = varName === "COMMANDS";
    const isSub = varName.endsWith("_COMMANDS") && varName !== "COMMANDS";
    if (!isTop && !isSub) continue;
    const names = new Set();
    const nameRe = /name:\s*"([^"]+)"/g;
    let nameMatch;
    while ((nameMatch = nameRe.exec(match[2])) !== null) {
      const firstWord = nameMatch[1].trim().split(/\s+/u)[0];
      if (firstWord) names.add(firstWord);
    }
    if (isTop) {
      for (const n of names) top.add(n);
    } else {
      const parent = varName.slice(0, -"_COMMANDS".length).toLowerCase();
      subs.set(parent, names);
    }
  }
  return { top, subs };
}

/** 从 SKILL.md 提取命令调用:顶层 `bin cmd`,子命令 `bin parent sub`。返回 { top, subs }。 */
function extractSkillCommands(skillText, bin) {
  const top = new Set();
  const subs = new Map();
  const re = new RegExp("(?:^|`|\\n)\\s*" + bin + "\\s+([a-z][a-z0-9-]*)(?:\\s+([a-z][a-z0-9-]*))?", "gmu");
  let match;
  while ((match = re.exec(skillText)) !== null) {
    const cmd = match[1];
    const sub = match[2];
    if (sub === undefined) {
      top.add(cmd);
    } else {
      top.add(cmd);
      let set = subs.get(cmd);
      if (set === undefined) {
        set = new Set();
        subs.set(cmd, set);
      }
      set.add(sub);
    }
  }
  return { top, subs };
}

let fail = 0;
let checked = 0;

for (const entry of SKILL_MAP) {
  const skillPath = join("skills", entry.skill, "SKILL.md");
  const cliPath = entry.cli;
  if (!existsSync(skillPath) || !existsSync(cliPath)) {
    console.log(`- ${entry.skill}:缺少 skill(${skillPath}) 或 CLI(${cliPath}),跳过`);
    continue;
  }

  let cliSource, skillText;
  try {
    cliSource = readFileSync(cliPath, "utf8");
    skillText = readFileSync(skillPath, "utf8");
  } catch (error) {
    console.log(`- ${entry.skill}:读取失败(${error.message}),跳过`);
    continue;
  }

  checked++;

  // ---- 第 1 层:命令集对比(阻止) ----
  const cli = extractCliCommands(cliSource);
  const skill = extractSkillCommands(skillText, entry.bin);

  const cliTotal = cli.top.size + [...cli.subs.values()].reduce((s, v) => s + v.size, 0);
  if (cli.top.size === 0) {
    console.log(`- ${entry.skill}:CLI 未解析出 COMMANDS(格式变化?),跳过命令对比`);
  } else {
    let issues = 0;
    // 顶层命令对比。
    const missingTop = [...cli.top].filter((c) => !skill.top.has(c));
    const staleTop = [...skill.top].filter((c) => !cli.top.has(c));
    if (missingTop.length > 0) {
      console.error(`✖ ${entry.skill}:SKILL.md 缺顶层命令 -> ${missingTop.join(", ")}`);
      issues++;
    }
    if (staleTop.length > 0) {
      console.error(`✖ ${entry.skill}:SKILL.md 含 CLI 已移除的顶层命令 -> ${staleTop.join(", ")}`);
      issues++;
    }
    // 子命令对比(父命令在 skill 里有子命令调用才检查)。
    for (const [parent, cliSubs] of cli.subs) {
      const skillSubs = skill.subs.get(parent);
      if (skillSubs === undefined) continue; // skill 没写该父命令的子命令,跳过
      const missingSub = [...cliSubs].filter((c) => !skillSubs.has(c));
      const staleSub = [...skillSubs].filter((c) => !cliSubs.has(c));
      if (missingSub.length > 0) {
        console.error(`✖ ${entry.skill}:SKILL.md 缺 ${parent} 子命令 -> ${missingSub.join(", ")}`);
        issues++;
      }
      if (staleSub.length > 0) {
        console.error(`✖ ${entry.skill}:SKILL.md 含 ${parent} 已移除的子命令 -> ${staleSub.join(", ")}`);
        issues++;
      }
    }
    if (issues === 0) {
      console.log(`✓ ${entry.skill}:命令集与 CLI 一致(${cliTotal} 命令)`);
    } else {
      fail = 1;
    }
  }

  // ---- 第 2 层:修改时间兜底(警告) ----
  try {
    const cliMtime = statSync(cliPath).mtimeMs;
    const skillMtime = statSync(skillPath).mtimeMs;
    if (cliMtime > skillMtime) {
      console.warn(
        `⚠ ${entry.skill}:CLI 源码修改晚于 SKILL.md(${new Date(cliMtime).toLocaleString()} vs ${new Date(skillMtime).toLocaleString()}),` +
          "请检查参数/语义/文档表是否已同步(命令名不变时本脚本扫描不到)",
      );
    }
  } catch {
    // stat 失败忽略
  }
}

if (checked === 0) {
  console.log("无 skill 可校验");
  process.exit(0);
}

if (fail) {
  console.error("\n请先更新对应 skills/*/SKILL.md 再提交;");
  console.error("确认为临时跳过可用 git commit --no-verify。");
  process.exit(1);
}
console.log(`\nCLI skill 同步校验通过(检查 ${checked} 个)✓`);
