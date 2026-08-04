import { CliError } from "./output.js";

/** 解析命令行参数。支持 --key value、--flag、-k value、positional。 */
export interface ParsedArgs {
  /** 位置参数(不含 flag 的值)。 */
  positionals: string[];
  /** 所有键值对(--key value)。 */
  values: Record<string, string>;
  /** 布尔 flag(--flag,无值)。 */
  flags: Set<string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const values: Record<string, string> = {};
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--") {
      // 之后全部视为位置参数。
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const eqIndex = name.indexOf("=");
      if (eqIndex !== -1) {
        values[name.slice(0, eqIndex)] = name.slice(eqIndex + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        values[name] = next;
        i++;
      } else {
        flags.add(name);
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      const name = arg.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        values[name] = next;
        i++;
      } else {
        flags.add(name);
      }
      continue;
    }
    positionals.push(arg);
  }

  return { positionals, values, flags };
}

/** 读取字符串参数。 */
export function getString(args: ParsedArgs, key: string, fallback?: string): string | undefined {
  return args.values[key] ?? fallback;
}

/** 读取数字参数。 */
export function getNumber(args: ParsedArgs, key: string, fallback?: number): number | undefined {
  const value = args.values[key];
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 读取布尔参数。 */
export function getBool(args: ParsedArgs, key: string, fallback = false): boolean {
  const value = args.values[key];
  if (value !== undefined) {
    return value === "true" || value === "1" || value === "yes";
  }
  return args.flags.has(key) ? true : fallback;
}

/** 读取必填字符串,缺失抛错。 */
export function requireString(args: ParsedArgs, key: string, what: string): string {
  const value = args.values[key];
  if (value === undefined || value === "") {
    throw new CliError(`Missing required option --${key} (${what})`);
  }
  return value;
}
