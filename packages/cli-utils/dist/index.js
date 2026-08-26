import { createLogger } from '@sakurachiyo0v0/logger';

const logger = createLogger({ namespace: "cli-utils" }).child("output");
/** CLI 运行错误。 */
class CliError extends Error {
    exitCode;
    constructor(message, exitCode = 1) {
        super(message);
        this.name = "CliError";
        this.exitCode = exitCode;
    }
}
/** 输出 JSON(默认,便于 AI/脚本解析)。 */
function outputJson(value) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}
/** 输出纯文本。 */
function outputText(value) {
    process.stdout.write(value.endsWith("\n") ? value : value + "\n");
}
/** 输出错误到 stderr。 */
function outputError(message) {
    process.stderr.write(`Error: ${message}\n`);
}
/** 统一异常处理:记录完整错误(含 stack),格式化并退出。 */
function handleCliError(error) {
    if (error instanceof CliError) {
        logger.error("cli command failed", { exitCode: error.exitCode, error });
        outputError(error.message);
        process.exit(error.exitCode);
    }
    if (error instanceof Error) {
        logger.error("cli command crashed", { error });
        outputError(error.message);
        process.exit(1);
    }
    logger.error("cli command crashed with unknown error", { error: String(error) });
    outputError(String(error));
    process.exit(1);
}
/** 打印帮助文本。 */
function printHelp(usage, commands, options) {
    outputText(usage);
    if (commands.length > 0) {
        outputText("\nCommands:");
        for (const command of commands) {
            outputText(`  ${command.name.padEnd(24)} ${command.desc}`);
        }
    }
    if (options.length > 0) {
        outputText("\nOptions:");
        for (const option of options) {
            outputText(`  ${option.flag.padEnd(28)} ${option.desc}`);
        }
    }
}
/** 简单进度条(写入 stderr,不污染 stdout 的 JSON)。 */
class ProgressBar {
    label;
    total;
    #lastRender = 0;
    constructor(label, total) {
        this.label = label;
        this.total = total;
    }
    update(current) {
        const now = Date.now();
        if (now - this.#lastRender < 100) {
            return;
        }
        this.#lastRender = now;
        const percent = this.total > 0 ? Math.min(100, (current / this.total) * 100) : 0;
        const width = 30;
        const filled = Math.round((percent / 100) * width);
        const bar = "█".repeat(filled) + "░".repeat(width - filled);
        process.stderr.write(`\r${this.label} [${bar}] ${percent.toFixed(0)}%`);
    }
    finish() {
        process.stderr.write("\r" + " ".repeat(80) + "\r");
    }
}

function parseArgs(argv) {
    const positionals = [];
    const values = {};
    const flags = new Set();
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
            }
            else {
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
            }
            else {
                flags.add(name);
            }
            continue;
        }
        positionals.push(arg);
    }
    return { positionals, values, flags };
}
/** 读取字符串参数。 */
function getString(args, key, fallback) {
    return args.values[key] ?? fallback;
}
/** 读取数字参数。 */
function getNumber(args, key, fallback) {
    const value = args.values[key];
    if (value === undefined) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
/** 读取布尔参数。 */
function getBool(args, key, fallback = false) {
    const value = args.values[key];
    if (value !== undefined) {
        return value === "true" || value === "1" || value === "yes";
    }
    return args.flags.has(key) ? true : fallback;
}
/** 读取必填字符串,缺失抛错。 */
function requireString(args, key, what) {
    const value = args.values[key];
    if (value === undefined || value === "") {
        throw new CliError(`Missing required option --${key} (${what})`);
    }
    return value;
}

export { CliError, ProgressBar, getBool, getNumber, getString, handleCliError, outputError, outputJson, outputText, parseArgs, printHelp, requireString };
