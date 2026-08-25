# @sakurachiyo0v0/config

配置中心 SDK:WebDAV 服务器 + 密钥**全局只配置一次**,各 SDK/平台通过 `namespace("平台名")` 存取自己的配置——路径自动隔离,**按域决定是否加密**(敏感配置加密上云,普通配置明文)。换机器配好全局配置即可还原,免重复配置。

## 特性

- 全局配置一次:`config setup` 写本地 `<配置根>/amechan/config.json`(chmod 600,密钥不出本机),之后 `createConfigCenter()` 自动读取
- namespace 隔离:`cc.namespace("xiaoheihe", { encrypt: true })` → 自动映射 `/amechan/secrets/xiaoheihe/*`(加密)或 `/amechan/configs/bilibili/*`(明文)
- 加密按域开关:`encrypt` 默认 false,敏感域显式 true——"敏感才加密"
- 复用 `@sakurachiyo0v0/webdav`(ConfigStore/EncryptedConfigStore),不重复造轮子
- CLI `amechan-config`:setup / status / get / set / list / remove / clear

## 适用环境

Node.js 20+。依赖已发布的 `@sakurachiyo0v0/webdav`(含加密存储)。

## 安装

```powershell
pnpm add @sakurachiyo0v0/config@workspace:*   # workspace 内
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/config"  # 其他机器
```

## 快速开始

```ts
import { createConfigCenter } from "@sakurachiyo0v0/config";

// 1. 一次性设置(也可用 CLI: amechan-config setup --url ... --username ... --password ... --key ...)
//    之后 createConfigCenter() 自动读取本地全局配置
const cc = createConfigCenter();   // 读 <配置根>/amechan/config.json

// 2. 各平台/模块命名空间
const xhh = cc.namespace("xiaoheihe", { encrypt: true });   // 敏感域: /amechan/secrets/xiaoheihe/*
await xhh.set("auth", { cookie: "SID=..." });                // 加密存取
const auth = await xhh.get<{ cookie: string }>("auth");

const bili = cc.namespace("bilibili");                       // 明文域: /amechan/configs/bilibili/*
await bili.set("ui", { quality: 80 });
const names = await bili.list();
await bili.remove("ui");
```

## API

### `createConfigCenter(options?): ConfigCenter`

| 选项 | 说明 |
| --- | --- |
| `configPath?` | 全局配置文件路径(默认 `<配置根>/amechan/config.json`,可用 `AME_CONFIG_PATH` 覆盖) |
| `global?` | 显式传入全局配置(不读文件):`{ url, username?, password?, key? }` |

### `ConfigCenter.namespace(name, options?): ConfigNamespace`

| 选项 | 说明 |
| --- | --- |
| `encrypt?` | 是否加密存储,默认 false;true=加密(需全局配置含 key 或环境变量 `WEBDAV_CONFIG_KEY`) |

| 方法 | 说明 |
| --- | --- |
| `get<T>(key)` | 读取配置(加密域自动解密) |
| `set(key, data)` | 写入(原子写 + 自动备份;加密域自动加密) |
| `list()` | 列出配置名 |
| `remove(key)` | 删除 |

namespace 不允许路径分隔符/`..`(防越界)。

### 全局配置工具

`saveGlobalConfig(config, path?)` / `loadGlobalConfig(path?)` / `clearGlobalConfig(path?)` / `resolveConfigPath(path?)`——本地全局配置读写(文件 600 权限)。

## 错误处理

- 远端错误透传 `@sakurachiyo0v0/webdav` 的 `WebdavError`:`AUTHENTICATION` / `CONNECTION` / `NOT_FOUND` / `DECRYPTION` / `CONFLICT`。
- 本地配置缺失/非法抛 `WebdavError(VALIDATION)`(如未 setup)。

## 注意事项

- **远端目录需预先存在**:`/amechan/configs/<ns>`、`/amechan/secrets/<ns>`(坚果云禁 WebDAV 建目录,网页端建;自建服务可用 `wd.mkdir` 建)。
- **密钥本地保管**:丢失则加密配置无法解密;换机器带同一份 WebDAV+密钥即可还原。

## CLI

```powershell
amechan-config setup --url ... --username ... --password ... --key ...
amechan-config status | clear
amechan-config get|set|list|remove <namespace> <key> [--encrypt] [--json <JSON>|--file <path>]
```

完整命令速查见 [`skills/config-cli/SKILL.md`](../../skills/config-cli/SKILL.md)。

## 在仓库内的验证方式

```powershell
pnpm --filter @sakurachiyo0v0/config typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/config build       # 构建 ESM + CJS + d.ts + CLI
pnpm --filter @sakurachiyo0v0/config test        # 单测(本地 webdav-server 真实协议路径)
```

## 设计文档

[`docs/superpowers/specs/2026-08-24-config-center-design.md`](../../docs/superpowers/specs/2026-08-24-config-center-design.md)
