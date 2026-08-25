import { rmSync } from "node:fs";

const remove = (directory) => rmSync(new URL(directory, import.meta.url), {
  recursive: true,
  force: true,
});

remove("../.build");

if (!process.argv.includes("--intermediate-only")) {
  remove("../dist");
  remove("../lib");
}
