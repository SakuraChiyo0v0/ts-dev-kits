/**
 * kazumi 本地 pack 消费验证 —— 从临时消费项目安装 tgz,验证 ESM/CJS 导入
 * 与规则加载链路,提前堵住"发布后才发现的打包/导出问题"。
 *
 * 用法: pnpm verify:kazumi-package
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = process.cwd();
const work = mkdtempSync(join(tmpdir(), "kazumi-pack-"));
const packDirectory = join(work, "pack");
const consumerDirectory = join(work, "consumer");
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli) {
  throw new Error("Run this verifier through the pnpm verify:kazumi-package script");
}

mkdirSync(packDirectory, { recursive: true });
mkdirSync(consumerDirectory, { recursive: true });

const runPnpm = (args, cwd) =>
  execFileSync(process.execPath, [pnpmCli, ...args], {
    cwd,
    stdio: "inherit",
  });

try {
  // 构建并打包(注意:kazumi 依赖 ffmpeg,ffmpeg 需先 build)
  runPnpm(["--filter", "@sakurachiyo0v0/ffmpeg", "build"], repo);
  runPnpm(["--filter", "@sakurachiyo0v0/kazumi", "build"], repo);
  runPnpm(
    [
      "--filter",
      "@sakurachiyo0v0/kazumi",
      "pack",
      "--pack-destination",
      packDirectory,
    ],
    repo,
  );

  const tarballName = readdirSync(packDirectory).find((name) =>
    name.endsWith(".tgz"),
  );
  if (!tarballName) {
    throw new Error("pnpm pack did not create a tarball");
  }
  const tarball = join(packDirectory, tarballName);

  // 消费项目依赖 ffmpeg(运行时从 GitHub Packages 装不到,这里用本地路径)
  writeFileSync(
    join(consumerDirectory, "package.json"),
    JSON.stringify(
      { name: "kazumi-sdk-pack-consumer", private: true, type: "module" },
      null,
      2,
    ),
  );
  runPnpm(["add", tarball], consumerDirectory);

  // ESM 导入
  writeFileSync(
    join(consumerDirectory, "esm.mjs"),
    [
      'import { createAnimeClient, KazumiError, RestrictedJsonPath, parseM3u8 } from "@sakurachiyo0v0/kazumi";',
      'const client = createAnimeClient({ rulesDir: "/nonexistent" });',
      'console.log("esm:", typeof createAnimeClient, typeof KazumiError, typeof RestrictedJsonPath, typeof parseM3u8);',
      'console.log("rules:", JSON.stringify(client.rules.list()));',
    ].join("\n"),
  );
  // CJS 导入
  writeFileSync(
    join(consumerDirectory, "cjs.cjs"),
    [
      'const { createAnimeClient, KazumiError } = require("@sakurachiyo0v0/kazumi");',
      'console.log("cjs:", typeof createAnimeClient, typeof KazumiError);',
    ].join("\n"),
  );

  execFileSync(process.execPath, ["esm.mjs"], {
    cwd: consumerDirectory,
    stdio: "inherit",
  });
  execFileSync(process.execPath, ["cjs.cjs"], {
    cwd: consumerDirectory,
    stdio: "inherit",
  });

  // CLI 可执行(pnpm 安装的 .bin shim,直接执行,依赖 shebang)
  execFileSync(
    join(consumerDirectory, "node_modules", ".bin", "sc-kazumi"),
    ["help"],
    { cwd: consumerDirectory, stdio: "inherit" },
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
