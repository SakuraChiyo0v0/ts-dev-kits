/** CLI 运行错误。 */
export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

/** 输出 JSON(默认,便于 AI/脚本解析)。 */
export function outputJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

/** 输出纯文本。 */
export function outputText(value: string): void {
  process.stdout.write(value.endsWith("\n") ? value : value + "\n");
}

/** 输出错误到 stderr。 */
export function outputError(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
}

/** 统一异常处理:格式化并退出。 */
export function handleCliError(error: unknown): never {
  if (error instanceof CliError) {
    outputError(error.message);
    process.exit(error.exitCode);
  }
  if (error instanceof Error) {
    outputError(error.message);
    process.exit(1);
  }
  outputError(String(error));
  process.exit(1);
}

/** 打印帮助文本。 */
export function printHelp(usage: string, commands: Array<{ name: string; desc: string }>, options: Array<{ flag: string; desc: string }>): void {
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
export class ProgressBar {
  #lastRender = 0;
  constructor(
    private readonly label: string,
    private readonly total: number,
  ) {}

  update(current: number): void {
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

  finish(): void {
    process.stderr.write("\r" + " ".repeat(80) + "\r");
  }
}
