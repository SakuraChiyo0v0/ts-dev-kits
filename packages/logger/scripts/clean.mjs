import { rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const intermediateOnly = args.includes("--intermediate-only");

if (intermediateOnly) {
  // 只清理 .build 中间产物
  const target = ".build";
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
} else {
  // 清理 dist 和 .build
  for (const target of ["dist", ".build"]) {
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
  }
}
