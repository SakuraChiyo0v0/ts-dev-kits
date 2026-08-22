import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.cwd();
const work = mkdtempSync(join(tmpdir(), "amechan-email-git-"));
const fixtureRepository = join(work, "email-repository");
const fixturePackage = join(fixtureRepository, "packages", "email");
const consumerDirectory = join(work, "consumer");
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli) {
  throw new Error("Run this verifier through the pnpm verify:email-git-package script");
}

mkdirSync(fixtureRepository, { recursive: true });
mkdirSync(fixturePackage, { recursive: true });
mkdirSync(consumerDirectory, { recursive: true });
cpSync(join(repo, "packages", "email"), fixturePackage, {
  recursive: true,
  filter: (source) => !["dist", "node_modules"].includes(basename(source)),
});

const run = (executable, args, cwd) =>
  execFileSync(executable, args, { cwd, stdio: "inherit" });
const runPnpm = (args, cwd) =>
  run(process.execPath, [pnpmCli, ...args], cwd);

run("git", ["init", "-b", "main"], fixtureRepository);
run("git", ["config", "core.autocrlf", "false"], fixtureRepository);
run("git", ["add", "--", "."], fixtureRepository);
run(
  "git",
  [
    "-c",
    "user.name=Package Verifier",
    "-c",
    "user.email=verifier@example.invalid",
    "commit",
    "-m",
    "fixture",
  ],
  fixtureRepository,
);

writeFileSync(
  join(consumerDirectory, "package.json"),
  JSON.stringify(
    { name: "email-sdk-git-consumer", private: true, type: "module" },
    null,
    2,
  ),
);
const gitUrl = pathToFileURL(fixtureRepository).href.replace(/^file:/u, "git+file:");
const packageUrl = `${gitUrl}#path:/packages/email`;
writeFileSync(
  join(consumerDirectory, "pnpm-workspace.yaml"),
  `allowBuilds:\n  '${`@sakurachiyo0v0/email@${gitUrl}`}': true\n`,
);
runPnpm(["add", packageUrl], consumerDirectory);
writeFileSync(
  join(consumerDirectory, "verify.mjs"),
  'import { smtpProvider } from "@sakurachiyo0v0/email";\nconsole.log(typeof smtpProvider);\n',
);
run(process.execPath, ["verify.mjs"], consumerDirectory);
