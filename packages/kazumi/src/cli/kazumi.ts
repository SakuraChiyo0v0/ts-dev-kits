#!/usr/bin/env node
/**
 * sc-kazumi CLI:search / roads / episodes / download / rules。
 * 环境变量注入(测试/自定义规则目录):
 *   AMECHAN_KAZUMI_RULES_DIR — 覆盖规则目录
 *   AMECHAN_KAZUMI_SYNC=1    — 开启规则 WebDAV 多端同步(需已 sc-config setup)
 */
import {
  getBool,
  getString,
  handleCliError,
  outputJson,
  printHelp,
  parseArgs,
} from "@sakurachiyo0v0/cli-utils";
import { readFileSync } from "node:fs";
import { createAnimeClient, defaultRulesDir, type AnimeClient } from "../client.js";
import { KazumiError } from "../errors.js";

const USAGE = "sc-kazumi <command> [options]";
const COMMANDS = [
  { name: "help", desc: "显示帮助" },
  { name: "search <keyword>", desc: "按关键词搜索(打全部规则)" },
  { name: "roads <src-url>", desc: "查询线路列表" },
  { name: "episodes <src-url>", desc: "查询集数列表(需 --rule 指定规则)" },
  { name: "download <url>", desc: "下载单集 mp4(--rule 指定规则,默认当前目录)" },
  { name: "rules list", desc: "列出已配置规则" },
  { name: "rules add <file>", desc: "导入规则 JSON 文件到规则目录" },
  { name: "rules remove <name>", desc: "删除规则" },
  { name: "rules validate <file>", desc: "校验规则 JSON 合法性" },
  { name: "rules test <name> <keyword>", desc: "本地试规则:输出匹配片段与诊断" },
];
const OPTIONS = [
  { flag: "--rule <name>", desc: "指定规则名(episodes/download 需要)" },
  { flag: "--output-dir <dir>", desc: "下载输出目录(默认当前目录)" },
  { flag: "--no-ad-filter", desc: "关闭 discontinuity 广告过滤" },
  { flag: "--json", desc: "JSON 输出" },
];

function rulesDir(): string {
  return process.env.AMECHAN_KAZUMI_RULES_DIR ?? defaultRulesDir();
}

function makeClient(): AnimeClient {
  // AMECHAN_KAZUMI_SYNC=1 开启规则 WebDAV 多端同步(需已 sc-config setup)。
  const sync = process.env.AMECHAN_KAZUMI_SYNC === "1";
  return createAnimeClient({ rulesDir: rulesDir(), ...(sync ? { sync } : {}) });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positionals[0] ?? "help";
  const client = makeClient();

  switch (command) {
    case "help":
      printHelp(USAGE, COMMANDS, OPTIONS);
      break;
    case "search":
      await runSearch(client, args);
      break;
    case "roads":
      await runRoads(client, args);
      break;
    case "episodes":
      await runEpisodes(client, args);
      break;
    case "download":
      await runDownload(client, args);
      break;
    case "rules":
      await runRules(client, args);
      break;
    default:
      printHelp(USAGE, COMMANDS, OPTIONS);
      process.exitCode = 1;
  }
}

async function runSearch(client: AnimeClient, args: ReturnType<typeof parseArgs>): Promise<void> {
  const keyword = args.positionals[1];
  if (!keyword) {
    throw new KazumiError("RULE_INVALID", "search 需要关键词参数");
  }
  const ruleName = getString(args, "rule");
  const items = await client.search(keyword, {
    ...(ruleName ? { rules: [ruleName] } : {}),
  });
  outputJson(items);
}

async function runRoads(client: AnimeClient, args: ReturnType<typeof parseArgs>): Promise<void> {
  const source = args.positionals[1];
  if (!source) {
    throw new KazumiError("RULE_INVALID", "roads 需要详情页 URL 参数");
  }
  const roads = await client.getRoads({ name: "", src: source });
  outputJson(roads);
}

async function runEpisodes(client: AnimeClient, args: ReturnType<typeof parseArgs>): Promise<void> {
  const source = args.positionals[1];
  const ruleName = getString(args, "rule");
  if (!source || !ruleName) {
    throw new KazumiError(
      "RULE_INVALID",
      "episodes 需要详情页 URL 与 --rule 参数",
    );
  }
  const trace = await (client as AnimeClient & {
    traceChapters(name: string, src: string): Promise<ChapterTraceLike>;
  }).traceChapters(ruleName, source);
  const all: { road: string; name: string; url: string }[] = [];
  for (const road of trace.roads) {
    for (let index = 0; index < road.data.length; index++) {
      all.push({
        road: road.name,
        name: road.identifier[index] ?? `第${index + 1}集`,
        url: road.data[index]!,
      });
    }
  }
  outputJson(all);
}

interface ChapterTraceLike {
  roads: { name: string; data: string[]; identifier: string[] }[];
}

async function runDownload(
  client: AnimeClient,
  args: ReturnType<typeof parseArgs>,
): Promise<void> {
  const url = args.positionals[1];
  const ruleName = getString(args, "rule");
  const outputDir = getString(args, "output-dir") ?? ".";
  const adFilter = !getBool(args, "no-ad-filter", false);
  if (!url || !ruleName) {
    throw new KazumiError("RULE_INVALID", "download 需要 URL 与 --rule 参数");
  }
  const name = args.positionals[2] ?? "episode";
  const { filePath } = await client.download(
    { name, url },
    {
      outputDir,
      rule: ruleName,
      adFilter,
      onProgress: (progress) => {
        if (!getBool(args, "json", false)) {
          process.stderr.write(
            `\r下载中: ${Math.round(progress.downloadedBytes / 1024)} KB @ ${Math.round(progress.speed / 1024)} KB/s`,
          );
        }
      },
    },
  );
  if (!getBool(args, "json", false)) {
    process.stderr.write("\n");
  }
  outputJson({ filePath });
}

async function runRules(client: AnimeClient, args: ReturnType<typeof parseArgs>): Promise<void> {
  const sub = args.positionals[1] ?? "list";
  switch (sub) {
    case "list": {
      outputJson(client.rules.list());
      break;
    }
    case "add": {
      const file = args.positionals[2];
      if (!file) {
        throw new KazumiError("RULE_INVALID", "rules add 需要规则 JSON 文件路径");
      }
      const raw = readFileSync(file, "utf-8");
      const json = JSON.parse(raw) as Record<string, unknown>;
      const name = await client.rules.add(json);
      const { join } = await import("node:path");
      outputJson({ added: name, path: join(rulesDir(), `${name}.json`) });
      break;
    }
    case "remove": {
      const name = args.positionals[2];
      if (!name) {
        throw new KazumiError("RULE_INVALID", "rules remove 需要规则名");
      }
      await client.rules.remove(name);
      outputJson({ removed: name });
      break;
    }
    case "validate": {
      const file = args.positionals[2];
      if (!file) {
        throw new KazumiError("RULE_INVALID", "rules validate 需要规则 JSON 文件路径");
      }
      const raw = readFileSync(file, "utf-8");
      const json = JSON.parse(raw) as Record<string, unknown>;
      const errors = client.rules.validateJson(json);
      if (errors.length > 0) {
        throw new KazumiError("RULE_INVALID", `规则校验失败: ${errors.join("; ")}`);
      }
      outputJson({ valid: true, name: String(json["name"] ?? "") });
      break;
    }
    case "test": {
      const name = args.positionals[2];
      const keyword = args.positionals[3];
      if (!name || !keyword) {
        throw new KazumiError("RULE_INVALID", "rules test 需要规则名与关键词");
      }
      const trace = await (client as AnimeClient & {
        traceSearch(name: string, keyword: string): Promise<{
          items: { name: string; src: string }[];
          matchedFragments: string[];
          diagnostics: string[];
          rawResponse: string;
        }>;
      }).traceSearch(name, keyword);
      outputJson({
        rule: name,
        count: trace.items.length,
        items: trace.items,
        matchedFragments: trace.matchedFragments.slice(0, 5),
        diagnostics: trace.diagnostics.slice(0, 20),
        rawResponsePreview: trace.rawResponse.slice(0, 500),
      });
      break;
    }
    default:
      throw new KazumiError("RULE_INVALID", `未知 rules 子命令: ${sub}`);
  }
}

main().catch((error) => {
  handleCliError(error);
});
