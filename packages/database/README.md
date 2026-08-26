# @sakurachiyo0v0/database

统一数据访问抽象层 SDK：**一套 async API 同时访问本地 SQLite 与远程 PostgreSQL / MySQL**，切换后端只改一行配置。适合本机脚本、服务端进程以及其他机器上的程序直接安装使用。

## 特性

- 同一套 `query` / `execute` / `transaction` / `ping` / `close`,SQLite / PostgreSQL / MySQL 写法一致
- 上层统一用 `?` 占位符,PG 适配器自动转 `$1/$2/...`(跳过单引号字符串内的 `?`,不误伤 JSONB 字面量)
- 事务失败自动回滚;嵌套事务明确报错,语义清晰
- 统一 `DataError` + 错误码,消息脱敏(不泄露连接串/密码)
- 远程库走连接池,事务期间固定同一条连接

## 适用环境

Node.js 20+,运行在可信任的服务端进程。SQLite 基于 better-sqlite3(原生模块,主流平台有预编译二进制)。

## 安装

同一 pnpm workspace 内:

```powershell
pnpm add @sakurachiyo0v0/database@workspace:*
```

从 GitHub monorepo 安装(需在消费项目 `pnpm-workspace.yaml` 中授权构建脚本,见 `docs/GITHUB_PACKAGES.md`):

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/database"
```

生产项目建议固定到已审核提交:

```json
{
  "dependencies": {
    "@sakurachiyo0v0/database": "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#<commit-sha>&path:/packages/database"
  }
}
```

### pnpm 11 消费者必需配置(supply-chain)

本包依赖 `better-sqlite3`(原生模块)。**pnpm 11 默认拦截依赖构建脚本**,消费项目不配置会报
`ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: better-sqlite3`。请在消费项目根目录的 `pnpm-workspace.yaml` 放行:

```yaml
allowBuilds:
  better-sqlite3: true
```

配置后再执行 `pnpm install` 即可。
```

## 快速开始

```ts
import { createDataStore } from "@sakurachiyo0v0/database";

// 本地 SQLite(文件库;":memory:" 表示仅内存的临时库)
const local = createDataStore({ dialect: "sqlite", path: "./data.db" });

// 远程 PostgreSQL / MySQL —— 其他机器上的程序也这样连,只需一条连接串
const remote = createDataStore({
  dialect: "postgres",
  url: "postgresql://user:pass@db.example.com:5432/mydb",
});

await local.execute(
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, age INTEGER)",
);
await local.execute("INSERT INTO users (name, age) VALUES (?, ?)", ["alice", 30]);

const users = await local.query<{ id: number; name: string; age: number }>(
  "SELECT id, name, age FROM users WHERE age > ?",
  [18],
);

await local.transaction(async (tx) => {
  await tx.execute("UPDATE users SET age = ? WHERE name = ?", [31, "alice"]);
  await tx.execute("DELETE FROM logs WHERE user_id = ?", [1]);
});

await local.ping();
await local.close();
```

## API

### `createDataStore(config): DataStore`

| 字段 | 说明 |
| --- | --- |
| `dialect: "sqlite"` | `path`:数据库文件路径(`":memory:"` 为内存库) |
| `dialect: "postgres"` | `url`:连接串;`maxConnections?`:连接池上限(默认 10) |
| `dialect: "mysql"` | `url`:连接串;`maxConnections?`:连接池上限(默认 10) |

### `DataStore` 方法

| 方法 | 说明 | 返回 |
| --- | --- | --- |
| `query<T>(sql, params?)` | 查询(参数化,防注入) | `Promise<T[]>` |
| `execute(sql, params?)` | 增删改 / DDL | `Promise<{ affectedRows }>` |
| `transaction(fn)` | 事务,`fn` 抛错自动回滚;嵌套调用抛 `TRANSACTION_ACTIVE` | `Promise<T>` |
| `ping()` | 探活,连不上抛 `CONNECTION` | `Promise<void>` |
| `close()` | 释放连接/连接池,幂等 | `Promise<void>` |

参数值支持 `string | number | boolean | null | Buffer`。

> **类型差异提醒**:PostgreSQL 的 `COUNT(*)`/`bigint`(int8)列超出 JS 安全整数范围,驱动默认返回**字符串**;SQLite/MySQL 返回 number。需要数值运算时请 `Number(...)` 转换。

## 占位符规则

- 上层统一写 `?`,按位置传参:
  ```ts
  await store.query("SELECT * FROM t WHERE a = ? AND b = ?", [1, "x"]);
  ```
- **PostgreSQL 自动转换**:`?` → `$1`/`$2`/...(顺序编号),单引号字符串内的 `?` 不转换。
- **PG JSONB 操作符**:
  - `?|` / `?&`(多字符操作符)原样保留,不会当作占位符;
  - 单 `?`(`data ? 'key'`)与占位符同形,请用 `??` 转义写成 `data ?? 'key'`(仅 PG 生效)。
  ```ts
  await store.query("SELECT * FROM t WHERE data ?? 'key' AND id = ?", [1]);
  // 实际执行:... WHERE data ? 'key' AND id = $1
  ```
- **SQLite / MySQL** 原生支持 `?`,直传;无需转义。

## 获取自增 id(lastInsertId)

`execute` 统一只返回 `affectedRows`,需要新插入行的 id 时按方言各取:

```ts
// SQLite
await store.execute("INSERT INTO users (name) VALUES (?)", ["alice"]);
const [{ id }] = await store.query("SELECT last_insert_rowid() AS id");

// PostgreSQL
const [{ id }] = await store.query("INSERT INTO users (name) VALUES (?) RETURNING id", ["alice"]);

// MySQL
await store.execute("INSERT INTO users (name) VALUES (?)", ["alice"]);
const [{ id }] = await store.query("SELECT LAST_INSERT_ID() AS id");
```

## 日志持久化与查询

配合 `@sakurachiyo0v0/logger` 使用:把日志写入本地 SQLite + 同步远程 PostgreSQL(跨机聚合),并提供 `queryLogs` API 与 `sc-log` CLI 按条件查询。

### 写入:DatabaseLogTransport

```ts
import { createLogger } from "@sakurachiyo0v0/logger";
import { DatabaseLogTransport } from "@sakurachiyo0v0/database";

const transport = new DatabaseLogTransport({
  // 本地 SQLite 默认 <配置根>/amechan/logs/<hostname>.db;传 false 禁用本地
  localPath: false,
  // "auto":从 WebDAV 加密配置自动解析连接串(推荐,不硬编码密码);
  // 或显式传连接串(如环境变量):remoteUrl: process.env.LOG_REMOTE_URL
  remoteUrl: "auto",
});
const logger = createLogger({ namespace: "bilibili", transport });

// 进程退出前
await transport.close();
```

- 本地 SQLite 即时写(离线可查);远程批量 flush(默认 1s / 200 条),失败自动重试保序。
- `remoteUrl: "auto"` 从 config 加密域 `namespace("logs", { encrypt: true })` 读取 `/amechan/secrets/logs/remote` 的连接串;也可用 `await DatabaseLogTransport.fromConfig()` 等价创建。
- 表结构首次写入自动创建,无需手动建表。

### 查询:queryLogs API

```ts
import { queryLogs } from "@sakurachiyo0v0/database";

const logs = await queryLogs({
  localPath: "~/.config/amechan/logs/desktop-01.db", // 查本地
  remoteUrl: "postgresql://.../logs",                // 查远程(跨机聚合)
  level: ["warn", "error"],      // 按等级
  hostname: "desktop-01",        // 按设备
  namespace: "bilibili",         // 按命名空间(子串)
  from: "2026-08-26T00:00:00Z",  // 按时间区间
  to: "2026-08-26T23:59:59Z",
  keyword: "download",           // 按关键词
  limit: 100, offset: 0,         // 分页
});
```

### 查询:sc-log CLI

```bash
sc-log --remote-url "$LOG_URL" --level error --since 1h --device desktop-01 --keyword download
```

参数:`--local-path` / `--remote-url` / `--level`(可重复)/ `--device` / `--namespace` / `--since`(`30m`/`1h`/`1d` 或 ISO)/ `--until` / `--keyword` / `--limit` / `--offset`。输出 JSON 数组。完整说明见 [`skills/database-cli/SKILL.md`](../../skills/database-cli/SKILL.md)。

## 错误处理

所有失败统一抛 `DataError`(带 `code` 字段,`cause` 保留底层错误;消息已脱敏):

| 错误码 | 含义 | 常见触发 |
| --- | --- | --- |
| `CONFIGURATION` | 配置非法 | 方言未知、缺 `path`、连接串解析失败 |
| `CONNECTION` | 连接/认证失败 | 连不上、密码错误、库不存在 |
| `QUERY_SYNTAX` | SQL 语法错误 / 对象不存在 | `SELECT FROM` |
| `CONSTRAINT` | 约束违反 | 重复主键、外键失败、非空 |
| `TRANSACTION_ACTIVE` | 嵌套事务 | 事务内再调 `transaction()` |
| `CLOSED` | 已关闭的数据源上操作 | `close()` 后 `query` |
| `TIMEOUT` | 操作超时(仅远程) | 慢查询超时、锁等待超时 |
| `UNKNOWN` | 其他未归类 | 磁盘满 |

```ts
import { DataError, DataErrorCode } from "@sakurachiyo0v0/database";

try {
  await store.query("SELECT FROM");
} catch (err) {
  if (err instanceof DataError && err.code === DataErrorCode.QUERY_SYNTAX) {
    // 处理语法错误
  }
}
```

## 在仓库内的验证方式

```powershell
pnpm --filter @sakurachiyo0v0/database typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/database test        # 单测(SQLite 内存库全量;PG/MySQL 见下)
pnpm --filter @sakurachiyo0v0/database build       # 构建 ESM + CJS + d.ts
```

PostgreSQL / MySQL 的真实协议路径测试默认跳过,设置了对应环境变量后自动启用(测试建临时表,收尾自清理):

```powershell
DATABASE_TEST_PG_URL=postgresql://user:pass@host:5432/db pnpm --filter @sakurachiyo0v0/database test
DATABASE_TEST_MYSQL_URL=mysql://user:pass@host:3306/db pnpm --filter @sakurachiyo0v0/database test
```

## 设计文档

[`docs/superpowers/specs/2026-08-24-database-sdk-design.md`](../../docs/superpowers/specs/2026-08-24-database-sdk-design.md)
