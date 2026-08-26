# 日志接入规范

本文定义 ts-dev-kits 各 SDK 包接入 [`@sakurachiyo0v0/logger`](../packages/logger/README.md) 的统一约定。所有包遵循此规范，保证日志格式、等级语义、消息语言一致。

## 一、基本原则

1. **消息语言：统一英文**。日志是排障工具，保持单一语言便于 grep 与日志系统聚合；不做 i18n。
2. **命名空间 = 包名**。每个包创建自己的 logger：`createLogger({ namespace: "bilibili" })`；子模块用 `logger.child("子模块")` 派生。
3. **结构化数据，不拼字符串**。上下文放第二个参数 `data` 对象，便于结构化解析：
   ```ts
   // ✅
   logger.info("download completed", { videoId, filePath });
   // ❌ 字符串拼接（不可结构化、不可检索）
   logger.info(`download ${videoId} completed at ${filePath}`);
   ```
4. **脱敏（强制）**。密码、cookie、token、私钥等一律不得写入日志（含 data 与 message）。日志中出现敏感字段即视为缺陷。
5. **等级语义统一**：
   - `debug`：详细过程（请求参数、中间状态、轮询结果等），默认不输出
   - `info`：关键操作成功（登录成功、下载开始/完成、配置保存等）
   - `warn`：可恢复的异常（降级、超时回退、重试、文件损坏视为未登录等）
   - `error`：操作失败（伴随抛错或直接失败返回）
6. **模块级实例**：logger 在模块顶层创建一次，不随函数调用重复创建。

## 二、错误处理

- 抛错前用 `logger.error(message, { ...context, error })` 记录（error 传原始 Error，transport 自动带 stack）。
- 抛 `AccountError`/`XxxError` 等统一错误时，错误码进 data：
  ```ts
  logger.error("login failed", { code: "NETWORK", error });
  ```
- 可恢复的降级路径用 `logger.warn` 而非 `error`。

## 三、替换存量 console

存量 `console.warn/error` 一律替换为 logger 调用，消息改写为英文、结构化：

| 存量（中文拼接） | 替换为 |
| --- | --- |
| `console.warn(\`[account] 读取登录态失败(\${path}):\`, error)` | `logger.warn("failed to read auth file", { path, error })` |

## 四、每包验证

接入完成后必须通过：

```powershell
pnpm --filter @sakurachiyo0v0/<name> typecheck
pnpm --filter @sakurachiyo0v0/<name> test
pnpm --filter @sakurachiyo0v0/<name> build
```

## 五、依赖接线

包内 `package.json` 添加：

```json
"dependencies": {
  "@sakurachiyo0v0/logger": "workspace:*"
}
```

若依赖图构建顺序需要，在根 `package.json` 的 `build` 脚本中确保 logger 先于依赖方构建（pnpm 按 workspace 依赖自动处理 `prepare`）。
