# @sakurachiyo0v0/logger

轻量级日志模块：级别控制、命名空间、多机来源标识、子 logger 派生、可替换 transport。

## 特性

- **级别控制**：`debug` < `info` < `warn` < `error`，可配置最低输出级别
- **命名空间**：每个包有自己的 namespace，日志自动带 `[namespace]` 前缀
- **主机标识**：自动检测 `os.hostname()` 区分多台机器，也可手动覆盖
- **子 logger**：支持派生子 logger，自动追加命名空间（如 `bilibili:download`）
- **bindings**：绑定固定 key-value 到 logger，每条日志自动附加
- **transport**：可替换输出目标（console/文件/自定义）
- **零依赖**：不依赖任何第三方包

## 安装

同一 pnpm workspace 内：

```powershell
pnpm add @sakurachiyo0v0/logger@workspace:*
```

从 GitHub monorepo 安装：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/logger"
```

## API

### `createLogger(options?)`

创建 logger 实例。

```ts
import { createLogger } from "@sakurachiyo0v0/logger";

const logger = createLogger({
  namespace: "bilibili",  // 命名空间
  level: "info",          // 最低级别（debug/info/warn/error/silent）
  hostname: "desktop-01", // 主机标识（可选，默认自动检测 os.hostname()）
  transport: custom,      // 自定义 transport（可选）
});
```

### `Logger.debug/info/warn/error(message, data?)`

输出日志。

```ts
logger.info("开始下载", { videoId: "BV123" });
logger.warn("清晰度不可用", { requested: 120, fallback: 80 });
logger.error("下载失败", new Error("network timeout"));
```

### `child(bindingsOrNamespace)`

派生子 logger。

```ts
// 字符串参数：追加命名空间
const downloadLogger = logger.child("download");
// namespace: "bilibili:download"

// 对象参数：绑定固定数据
const boundLogger = logger.child({ videoId: "BV123" });
// 每条日志自动带 videoId: "BV123"
```

### `@timed()` 耗时装饰器

为标准类方法自动记录耗时（ECMAScript 标准装饰器，无需 experimentalDecorators）。同步/异步方法均支持。

```ts
import { createLogger, timed } from "@sakurachiyo0v0/logger";

class Downloader {
  readonly logger = createLogger({ namespace: "bilibili" });

  @timed()                                     // 默认取 this.logger，记录名 "Downloader.download"
  async download(videoId: string): Promise<void> { ... }

  @timed({ name: "merge", level: "debug" })    // 覆盖记录名 / 成功级别
  merge(): void { ... }
}
```

输出（logger 为 debug 级别时含 start 行）：

```text
[bilibili]@desktop-01 ... DEBUG timed start { name: 'Downloader.download' }
[bilibili]@desktop-01 ... INFO timed done { name: 'Downloader.download', durationMs: 3210 }
[bilibili]@desktop-01 ... ERROR timed failed { name: 'Downloader.download', durationMs: 1520, error: Error: ... }
```

选项：

| 选项 | 说明 |
|---|---|
| `logger` | 显式指定 logger；缺省取实例 `this.logger`，再缺省用 namespace "timed" 的默认 logger |
| `name` | 覆盖记录名（缺省 `<类名>.<方法名>`） |
| `level` | 成功日志级别 `debug`/`info`（默认 `info`） |
| `logStart` | 是否记录开始日志（默认 `true`） |

### 自定义 Transport

实现 `LogTransport` 接口：

```ts
import type { LogTransport, LogEntry } from "@sakurachiyo0v0/logger";

class FileTransport implements LogTransport {
  write(entry: LogEntry): void {
    // 写入文件...
  }
}

const logger = createLogger({ transport: new FileTransport() });
```

## 在 SDK 中使用

```ts
// packages/bilibili/src/index.ts
import { createLogger } from "@sakurachiyo0v0/logger";

const logger = createLogger({ namespace: "bilibili" });

export async function download(videoId: string) {
  logger.info("开始下载", { videoId });
  
  const child = logger.child({ videoId });
  child.info("获取流信息");
  child.info("下载完成");
}
```

## 环境要求

- Node.js >= 20

## 验证

```powershell
pnpm --filter @sakurachiyo0v0/logger typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/logger test        # 单测
pnpm --filter @sakurachiyo0v0/logger build       # 构建
```
