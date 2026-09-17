# @sakurachiyo0v0/config-pg

按需安装的 PostgreSQL 配置后端，依赖 config 核心和 pg，不依赖 WebDAV。Node.js 20+。

```sh
pnpm add @sakurachiyo0v0/config @sakurachiyo0v0/config-pg
```

```ts
import { createConfigCenter } from "@sakurachiyo0v0/config";
import { PgBackend } from "@sakurachiyo0v0/config-pg";
const backend = new PgBackend({ url: process.env.DATABASE_URL!, table: "config_kv" });
try {
  const remote = createConfigCenter({ backend, key: process.env.CONFIG_KEY! }).namespace("auth");
  await remote.set("example", { value: 1 });
  console.log(await remote.get("example"));
} finally {
  await backend.close();
}
```

`new PgBackend({ url, table? })`：url 为连接串；table 默认 config_kv，仅允许合法字母/数字/下划线标识符。

- `init()` 可显式建表，也会在首次操作时惰性建表，连接账号需有相应权限。
- `load<T>(key)`、`save(key, value)`、`list()`、`remove(key)`：参数化键值操作。缺失键抛 ConfigError，code=NOT_FOUND。
- `withPrefix(prefix)`：共享连接池的键前缀包装；`close()` 由拥有根后端的调用方负责。
- 表结构 key TEXT PRIMARY KEY / value TEXT NOT NULL / updated_at TIMESTAMPTZ；已有表名、键前缀和密文格式不变。

SQL/连接错误透传 pg 的错误；不要把连接串或原始错误写入公开日志。此包不提供 CLI。
