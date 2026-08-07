/** 解析命令行参数。支持 --key value、--flag、-k value、positional。 */
export interface ParsedArgs {
    /** 位置参数(不含 flag 的值)。 */
    positionals: string[];
    /** 所有键值对(--key value)。 */
    values: Record<string, string>;
    /** 布尔 flag(--flag,无值)。 */
    flags: Set<string>;
}
export declare function parseArgs(argv: string[]): ParsedArgs;
/** 读取字符串参数。 */
export declare function getString(args: ParsedArgs, key: string, fallback?: string): string | undefined;
/** 读取数字参数。 */
export declare function getNumber(args: ParsedArgs, key: string, fallback?: number): number | undefined;
/** 读取布尔参数。 */
export declare function getBool(args: ParsedArgs, key: string, fallback?: boolean): boolean;
/** 读取必填字符串,缺失抛错。 */
export declare function requireString(args: ParsedArgs, key: string, what: string): string;
