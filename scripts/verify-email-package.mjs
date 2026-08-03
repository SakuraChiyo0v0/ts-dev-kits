import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = process.cwd();
const work = mkdtempSync(join(tmpdir(), "amechan-email-pack-"));
const packDirectory = join(work, "pack");
const consumerDirectory = join(work, "consumer");
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli) {
  throw new Error("Run this verifier through the pnpm verify:email-package script");
}

mkdirSync(packDirectory, { recursive: true });
mkdirSync(consumerDirectory, { recursive: true });

const runPnpm = (args, cwd) =>
  execFileSync(process.execPath, [pnpmCli, ...args], {
    cwd,
    stdio: "inherit",
  });

runPnpm(["--filter", "@amechan/email", "build"], repo);
runPnpm(
  [
    "--filter",
    "@amechan/email",
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

writeFileSync(
  join(consumerDirectory, "package.json"),
  JSON.stringify(
    { name: "email-sdk-pack-consumer", private: true, type: "module" },
    null,
    2,
  ),
);
runPnpm(["add", tarball], consumerDirectory);

writeFileSync(
  join(consumerDirectory, "esm.mjs"),
  'import { createEmailClient } from "@amechan/email";\nconsole.log(typeof createEmailClient);\n',
);
writeFileSync(
  join(consumerDirectory, "cjs.cjs"),
  'const { createEmailClient } = require("@amechan/email");\nconsole.log(typeof createEmailClient);\n',
);

execFileSync(process.execPath, ["esm.mjs"], {
  cwd: consumerDirectory,
  stdio: "inherit",
});
execFileSync(process.execPath, ["cjs.cjs"], {
  cwd: consumerDirectory,
  stdio: "inherit",
});
