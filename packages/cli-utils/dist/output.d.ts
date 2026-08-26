/** CLI 运行错误。 */
export declare class CliError extends Error {
    readonly exitCode: number;
    constructor(message: string, exitCode?: number);
}
/** 输出 JSON(默认,便于 AI/脚本解析)。 */
export declare function outputJson(value: unknown): void;
/** 输出纯文本。 */
export declare function outputText(value: string): void;
/** 输出错误到 stderr。 */
export declare function outputError(message: string): void;
/** 统一异常处理:记录完整错误(含 stack),格式化并退出。 */
export declare function handleCliError(error: unknown): never;
/** 打印帮助文本。 */
export declare function printHelp(usage: string, commands: Array<{
    name: string;
    desc: string;
}>, options: Array<{
    flag: string;
    desc: string;
}>): void;
/** 简单进度条(写入 stderr,不污染 stdout 的 JSON)。 */
export declare class ProgressBar {
    #private;
    private readonly label;
    private readonly total;
    constructor(label: string, total: number);
    update(current: number): void;
    finish(): void;
}
