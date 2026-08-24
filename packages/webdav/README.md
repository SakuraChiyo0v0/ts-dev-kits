# @sakurachiyo0v0/webdav

WebDAV 配置存取 SDK：**基础文件操作**（读/写/列/删/建目录/移动/复制）+ **配置文件存储高层 API**（原子写 + 自动备份），并带 CLI（`amechan-webdav`）。适合存配置文件、多端同步的轻量场景（SQL 过重、WebDAV 刚刚好）。

## 特性

- 基于成熟 `webdav` 库（HTTP + PROPFIND + XML 细节已处理），统一错误 + 消息脱敏
- `ConfigStore.save()` 原子写（临时文件 + move 覆盖，写一半不损坏）+ 旧版本自动滚动备份（`.bak.1/.bak.2/...`）
- 配置格式：`json`（自动序列化/解析）与 `text`
- CLI `amechan-webdav`：文件操作 + 配置存取，JSON 输出，报错带错误码

## 适用环境

Node.js 20+。支持 Basic 认证的 WebDAV 服务（坚果云、Nextcloud、自有服务等）。

## 安装

同一 pnpm workspace 内:

```powershell
pnpm add @sakurachiyo0v0/webdav@workspace:*
```

从私有 GitHub monorepo 安装（需在消费项目 `pnpm-workspace.yaml` 中授权构建脚本）:

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/webdav"
```

## 快速开始

```ts
import { createWebdavClient, createConfigStore } from "@sakurachiyo0v0/webdav";

// 1. 基础文件操作
const wd = createWebdavClient({
  url: "https://dav.jianguoyun.com/dav/",
  username: "user",
  password: "pass",
});
await wd.ping();
await wd.mkdir("/configs");
await wd.put("/configs/app.json", JSON.stringify({ theme: "dark" }), { overwrite: true });
const files = await wd.list("/configs");
const content = await wd.get("/configs/app.json");

// 2. 配置文件高层 API（原子写 + 自动备份）
const store = createConfigStore({ client: wd, basePath: "/configs", format: "json", backupCount: 3 });
await store.save("app.json", { theme: "light", version: 2 }); // 旧版自动存 .bak.1
const cfg = await store.load<{ theme: string; version: number }>("app.json");
const names = await store.list();   // ["app.json", ...]
await store.remove("app.json");
```

## API

### `createWebdavClient(config): WebdavClient`

| 字段 | 说明 |
| --- | --- |
| `url` | WebDAV 根地址（必填），如 `https://dav.jianguoyun.com/dav/` |
| `username?` / `password?` | Basic 认证 |
| `timeoutMs?` | 请求超时毫秒数，默认 15000 |

### `WebdavClient` 方法

| 方法 | 说明 |
| --- | --- |
| `ping()` | 连通性检查 |
| `list(path)` | 列目录 → `WebdavFileStat[]`（path/name/type/size/lastModified） |
| `get(path)` | 读文件 → 文本内容 |
| `getBinary(path)` | 读文件 → `Buffer`（zip/图片等二进制） |
| `put(path, content, {overwrite?})` | 写文本；`overwrite:false` 时已存在抛 `CONFLICT`（真实服务器返回 412） |
| `putBinary(path, buffer, {overwrite?})` | 写二进制（`Buffer`） |
| `mkdir(path)` | 建目录 |
| `remove(path)` | 删文件/空目录 |
| `move(from, to)` | 移动/重命名（覆盖目标） |
| `copy(from, to)` | 复制（覆盖目标） |
| `exists(path)` | 判断存在性 |

### `createConfigStore(client, options?): ConfigStore`

| 选项 | 说明 |
| --- | --- |
| `basePath?` | 远端配置目录，默认 `/configs/` |
| `format?` | `json`（默认）或 `text` |
| `backupCount?` | 保留历史备份数，默认 3，`0`=不备份 |

| 方法 | 说明 |
| --- | --- |
| `load<T>(name)` | 读取并解析配置；不存在抛 `NOT_FOUND` |
| `save(name, data)` | 原子写 + 自动滚动备份 |
| `list()` | 列出配置（过滤 `.tmp` 与 `.bak.*`） |
| `remove(name)` | 删除配置 |

配置名不允许路径分隔符/`..`（防路径越界）。

## 错误处理

统一抛 `WebdavError`（带 `code`，`cause` 保留底层错误；消息脱敏）：

| 错误码 | 含义 | 触发示例 |
| --- | --- | --- |
| `AUTHENTICATION` | 认证失败(401/403) | 密码/token 错 |
| `CONNECTION` | 网络/连接失败、超时 | 服务器不可达 |
| `NOT_FOUND` | 文件/目录不存在(404) | `get` 不存在的文件 |
| `CONFLICT` | 冲突(409/412) | 不覆盖写已存在文件 |
| `VALIDATION` | 参数非法 | 空 URL、非法路径/配置名 |
| `UNKNOWN` | 其他 | 服务端 5xx |

## CLI

```powershell
amechan-webdav ping|list|get|put|delete|mkdir|rmdir|move|config-load|config-save
# 连接:--url/--username/--password 或环境变量 WEBDAV_URL/WEBDAV_USERNAME/WEBDAV_PASSWORD
```

用法示例：

```powershell
amechan-webdav ping
amechan-webdav put /configs/app.json --data '{"theme":"dark"}'
amechan-webdav config-load app.json
amechan-webdav config-save app.json --json '{"theme":"light"}'
```

完整命令速查见 [`skills/webdav-cli/SKILL.md`](../../skills/webdav-cli/SKILL.md)。

## 在仓库内的验证方式

```powershell
pnpm --filter @sakurachiyo0v0/webdav typecheck   # 类型检查
pnpm --filter @sakurachiyo0v0/webdav build       # 构建 ESM + CJS + d.ts + CLI
pnpm --filter @sakurachiyo0v0/webdav test        # 单测(本地 webdav-server 真实协议路径)
```

## 设计文档

[`docs/superpowers/specs/2026-08-24-webdav-sdk-design.md`](../../docs/superpowers/specs/2026-08-24-webdav-sdk-design.md)
