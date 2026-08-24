# `@sakurachiyo0v0/database` 数据访问抽象层 SDK 设计

状态:起草中(批准后改为「用户已批准」)
日期:2026-08-24

## 1. 当前问题与目标

- 现状:仓库里没有统一的数据访问能力。个人脚本/项目要读写数据时,本地要么手写 SQLite 胶水代码,远程要么各自连 PostgreSQL/MySQL,接口不统一、错误处理不一致、凭据容易散落。其他机器上的程序要用数据时也没有开箱即用的访问层。
- 目标:新增 `@sakurachiyo0v0/database` 包——一套统一 API 同时访问本地 SQLite 与远程 PostgreSQL / MySQL,配置切换后端,作为 npm 包经 GitHub Packages 分发,本机脚本与其他机器上的程序装包即用。本阶段只交付 SDK 抽象层,不做 HTTP 服务包装(见方案选择)。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 每个项目各自写 SQLite/PostgreSQL/MySQL 胶水,接口各异 | 一行 `createDataStore({ dialect, ... })`,SQLite/PG/MySQL 同一套 API |
| 切换数据库要重写代码 | 改配置对象里的 `dialect` 即可,业务代码不变 |
| 错误结构不一致、凭据可能出现在日志 | 统一 `DataError` + 错误码,消息脱敏 |
| 远程库(如内网 PG)要别人连,得自己起服务或教对方装驱动 | 对方装一个 npm 包、配一条连接串即可 |

## 3. 方案选择

### 方案 A:只做 SQLite + PostgreSQL 最小版(不采用)

- 优点:工作量再小一点。
- 缺点:用户已拍板 MySQL 也要;适配器都是薄封装,接口统一后三个驱动的工作量差别不大,一次做齐避免后续重复走发布流程。

### 方案 B:三适配器统一抽象,上层统一 `?` 占位符(采用)

- 优点:调用方只学一种占位符写法;适配器内部把 `?` 转成各方言(PG 的 `$1` 等),并跳过单引号字符串内的 `?`(PG JSON 操作符 `?` 不误伤);新增数据库 = 实现一个薄适配器接口,符合仓库「供应商无关接口 + 适配器可替换」的既有模式(email/chat-platforms 同款)。
- 缺点:占位符转换器需要自己写一个带字符串识别的小解析器(约 30 行,可单测);相比直接用各方言原生占位符多一层间接,换来的是上层零方言知识。

### 方案 C:SDK 之上再加 HTTP 数据服务进程(本阶段不采用)

- 优点:其他程序不用装 Node 依赖,直接 HTTP 调。
- 缺点:引入服务端进程的部署、鉴权、端口管理等整套复杂度;当前使用者(本机脚本 + 其他机器上的程序)都是 Node 环境,装包即可覆盖。若后续出现「非 Node 消费者」或「内网数据库不能直连」的场景,再基于本包加一个可选 HTTP 包装,属渐进式扩展,不影响本包接口。

### 其他取舍

- 接口统一为 async(即使 better-sqlite3 底层同步):SQLite 适配器内部 `await` 一层,上层代码对三种后端写法一致,也便于未来换异步驱动。
- 远程驱动(pg / mysql2)与本地驱动(better-sqlite3)全部放 `dependencies`:装包即用、无需二次安装;rollup 打包时声明 external。
- `execute` 只返回 `affectedRows`,不返回 `lastInsertId`(PG 的 INSERT 拿自增 id 必须 `RETURNING`,无法跨方言统一):需要新 id 时按方言各取(sqlite `SELECT last_insert_rowid()`、PG `INSERT ... RETURNING id`、mysql `SELECT LAST_INSERT_ID()`),文档给出示例。
- 事务不支持嵌套:事务内再调 `transaction()` 抛 `TRANSACTION_ACTIVE`,语义清晰、实现简单;不做 savepoint。

## 4. 仓库结构

```text
packages/database/
├─ src/
│  ├─ index.ts            公共出口:只导出稳定 API
│  ├─ types.ts            配置/DataStore/Params/ExecuteResult 等类型
│  ├─ errors.ts           DataError + 错误码 + 底层错误归类
│  ├─ placeholder.ts      统一 `?` → 各方言占位符的转换器(含单引号识别)
│  ├─ store.ts            DataStore 公共实现(事务状态机/参数校验)
│  └─ adapters/
│     ├─ sqlite.ts        better-sqlite3 适配器
│     ├─ postgres.ts      pg 适配器(Pool)
│     └─ mysql.ts         mysql2 适配器(pool)
├─ tests/
│  ├─ sqlite.test.ts      内存库全量功能测试(真实协议路径)
│  ├─ placeholder.test.ts 占位符转换器纯函数测试
│  ├─ postgres.test.ts    环境变量存在才跑,临时表自清理
│  └─ mysql.test.ts       同 postgres
├─ package.json
├─ tsconfig.json / tsconfig.build.json / tsconfig.bundle.json
├─ rollup.config.mjs
├─ scripts/clean.mjs
└─ README.md
```

## 5. 接口设计

### 类型与枚举

```ts
// 配置:方言 + 该方言连接参数,互斥联合,字段语义以 types.ts 为权威
type DataStoreConfig =
  | { dialect: "sqlite"; path: string }                 // ":memory:" 表示内存库
  | { dialect: "postgres"; url: string; maxConnections?: number }
  | { dialect: "mysql"; url: string; maxConnections?: number };

type Params = (string | number | boolean | null | Buffer)[];

interface ExecuteResult {
  affectedRows: number;
}

interface DataStore {
  readonly dialect: "sqlite" | "postgres" | "mysql";
  query<T extends Row = Row>(sql: string, params?: Params): Promise<T[]>;
  execute(sql: string, params?: Params): Promise<ExecuteResult>;
  transaction<T>(fn: (tx: DataStore) => Promise<T>): Promise<T>; // 嵌套调用抛 TRANSACTION_ACTIVE
  ping(): Promise<void>;   // 探活,连不上抛 CONNECTION
  close(): Promise<void>;  // 释放连接/池,幂等
}

type Row = Record<string, unknown>;
```

### API 形状

```ts
import { createDataStore } from "@sakurachiyo0v0/database";

// 本地
const local = createDataStore({ dialect: "sqlite", path: "./data.db" });
// 远程(其他机器上的程序也这样连,只需一条连接串)
const remote = createDataStore({ dialect: "postgres", url: "postgresql://user:***@host:5432/db" });

const users = await local.query<{ id: number; name: string }>("SELECT id, name FROM users WHERE age > ?", [18]);
await local.execute("INSERT INTO users (name, age) VALUES (?, ?)", ["alice", 30]);
await local.transaction(async (tx) => {
  await tx.execute("UPDATE users SET age = ? WHERE name = ?", [31, "alice"]);
  await tx.execute("DELETE FROM logs WHERE user_id = ?", [1]);
});
await local.ping();
await local.close();
```

- 参数化由驱动原生执行(SQLite/PG/MySQL 均防注入),不自行拼接 SQL。
- 占位符:上层统一 `?`;PG 适配器按出现顺序转 `$1/$2/...` 且跳过单引号字符串内的 `?`;SQLite/MySQL 原生支持 `?` 直传。
- 配置或 SQL 非法 → `DataError`,消息脱敏,不带连接串/密码。

## 6. 错误处理

| 错误码 | 含义 | 触发示例 |
| --- | --- | --- |
| `CONFIGURATION` | 配置非法(方言未知/缺必填项/URL 解析失败) | `{ dialect: "mongo" }` |
| `CONNECTION` | 连接/认证失败(含超时、数据库不存在) | 连不上的 host、密码错误 |
| `QUERY_SYNTAX` | SQL 语法错误 | `SELECT FROM` |
| `CONSTRAINT` | 约束违反(唯一/外键/非空) | 插入重复主键 |
| `TRANSACTION_ACTIVE` | 事务内再开事务 | `transaction` 嵌套 |
| `CLOSED` | 在已关闭的 store 上操作 | `close()` 后 `query` |
| `TIMEOUT` | 操作超时(仅远程方言) | 慢查询超时 |
| `UNKNOWN` | 其他 | 磁盘满 |

底层错误(pg `DatabaseError`、mysql 错误码、sqlite `SqliteError`)按 code/message 归类到上表,原始错误放 `cause` 保留排查信息。

## 7. 测试策略

- **SQLite(真实协议路径,`:memory:` 内存库,默认全跑):**
  - CRUD 往返、类型保持(数字/文本/null/Buffer)
  - 事务提交 / 异常回滚 / 嵌套事务抛 `TRANSACTION_ACTIVE`
  - 注入安全:参数含 `'; DROP TABLE users; --` 时按字面值插入,不执行
  - 错误分支:语法错误 → `QUERY_SYNTAX`;唯一约束 → `CONSTRAINT`;`close()` 后操作 → `CLOSED`;配置非法 → `CONFIGURATION`
- **占位符转换器(纯函数):** 顺序编号、单引号内 `?` 跳过、转义引号 `''` 处理。
- **PostgreSQL / MySQL(可选):** 环境变量 `DATABASE_TEST_PG_URL` / `DATABASE_TEST_MYSQL_URL` 存在才跑(`describe.skipIf`),否则跳过保证 CI 全绿;测试建临时表,结束后 DROP 自清理。
- **写操作自清理:** SQLite 用内存库天然自清理;远程库测试用唯一表名 + 收尾 DROP。

## 8. CLI 与 skill 同步

- 本包无 CLI(纯库,面向程序调用),不新增 `skills/*`。
- 确认 `scripts/check-skill-staleness.mjs` 对无 CLI 包不产生守卫冲突(实现阶段验证)。

## 9. 版本与发布

- 新包 `version: 0.1.0`,license `UNLICENSED`,`files` 只发 `dist` + `README.md`。
- 接线:根 `package.json` `build` 追加 `pnpm --filter @sakurachiyo0v0/database build`;`.github/workflows/publish.yml` 发布顺序加入 `database`(实现阶段核对 `scripts/publish-packages.mjs` 与 CI 中的顺序定义)。
- 发布后跑 `pnpm verify:published @sakurachiyo0v0/database` 消费验证。

## 10. 验收条件

- [ ] spec 经用户批准
- [ ] 最小示例跑通:SQLite 与 PostgreSQL/MySQL(若有可用实例)同代码 CRUD
- [ ] `pnpm --filter @sakurachiyo0v0/database typecheck && test` 全绿(SQLite 全量,远程可选)
- [ ] `pnpm --filter @sakurachiyo0v0/database build` 产出 ESM + CJS + d.ts
- [ ] README(安装方式/API/占位符/错误码/各方言取 lastInsertId 示例)+ `docs/packages-index.md` 总览与详情更新
- [ ] 根 build / publish 顺序接线完成
- [ ] `pnpm check` 全仓通过
- [ ] 用户确认后提交推送,CI 发布成功,`pnpm verify:published` 消费验证通过
