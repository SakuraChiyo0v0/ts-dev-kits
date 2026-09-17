# @sakurachiyo0v0/config

1.0 起为轻量配置核心：后端接口、命名空间、JSON/加密包装和配置根目录解析。仅依赖 logger，不安装 WebDAV 或数据库驱动。Node.js 20+。

## 安装与使用

```sh
pnpm add @sakurachiyo0v0/config
# 按实际需要选择一个
pnpm add @sakurachiyo0v0/config-webdav
pnpm add @sakurachiyo0v0/config-pg
```

```ts
import { createConfigCenter } from "@sakurachiyo0v0/config";
import { createWebdavBackend } from "@sakurachiyo0v0/config-webdav";

const center = createConfigCenter({
  backend: createWebdavBackend({ url: process.env.WEBDAV_URL! }),
  key: process.env.CONFIG_KEY!,
});
const ns = center.namespace("auth");
await ns.set("example", { value: 1 });
const value = await ns.get<{ value: number }>("example");
```

## 接口

- `createConfigCenter({ backend, key? })`：backend 必填，key 不传时加密包装读取 CONFIG_KEY。
- `namespace(name, { encrypt? })`：encrypt 默认 true；明文需显式 false。命名空间禁止空值、斜杠、反斜杠、冒号和 `..`。
- 命名空间提供 `get<T>(key)`、`set(key, data)`、`list()`、`remove(key)`，全部异步。
- `initConfig(options)` 设置进程默认实例；`config()` 读取；`config(options)` 创建独立实例；`resetConfig()` 清除默认实例。
- `ConfigBackend` 提供 `load<T>/save/list/remove/withPrefix`。存储层保持字符串透明，上层负责 JSON 和加密。
- `PrefixBackend` 使用冒号隔离键；`JsonBackend` 处理 JSON；`EncryptedBackend` 使用 AES-256-GCM，`encryptedBackend()` 支持环境变量密钥；`deriveKey()` 派生密钥。
- `resolveConfigRoot(platform?, env?)` 保留配置根目录规则：AMECHAN_CONFIG_HOME 优先，然后平台标准目录。

`ConfigError.code`：VALIDATION 表示非法配置；NOT_FOUND 表示适配器报告键不存在。底层连接/认证错误由适配器返回。加密格式和 `amechan:secrets/configs:<namespace>` 前缀保持不变。

1.0 不保留旧 WebDAV/PG 导入、global 选项或 CLI。见 [迁移说明](../../docs/config-backends-migration.md)。
