# @sakurachiyo0v0/cli-utils

各工具包 CLI 共用的参数解析、输出和错误处理工具。属于通用基础，仅运行依赖 logger。

```sh
pnpm add @sakurachiyo0v0/cli-utils
```

公开入口：

- 参数：`parseArgs`、`getString`、`getNumber`、`getBool`、`requireString`、`ParsedArgs`。
- 输出：`outputJson`、`outputText`、`outputError`、`printHelp`、`ProgressBar`。
- 错误：`CliError`、`handleCliError`。

参数与返回类型以公开 TypeScript 声明为准。包使用 ESM/CJS 双入口，详见 [仓库包索引](../../docs/packages-index.md#foundation)。
