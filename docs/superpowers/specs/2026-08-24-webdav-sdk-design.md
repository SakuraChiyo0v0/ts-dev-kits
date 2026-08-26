# `@sakurachiyo0v0/webdav` WebDAV 配置存取 SDK 设计

状态:起草中(批准后改为「用户已批准」)
日期:2026-08-24

## 1. 当前问题与目标

- 现状:有一些 WebDAV 服务(坚果云/Nextcloud 等),配置文件(JSON/文本)需要多端同步存取。用 SQL 存配置过重(无 schema、连接池、部署成本),直接手写 WebDAV HTTP+XML 又繁琐易错。
- 目标:新增 `@sakurachiyo0v0/webdav` 包——包装成熟 WebDAV 客户端,提供**基础文件操作**(读/写/列/删/建目录/移动/复制)与**配置文件存储高层 API**(load/save/原子写/备份),并带 CLI(`sc-webdav`)方便命令行存取,配套 skill 手册。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 存配置文件要么塞 SQL(重),要么手写 WebDAV 请求(繁琐易错) | `createWebdavClient()` 一行连接,`ConfigStore` 一条 API 读写配置 |
| 配置文件更新无原子性/无备份,写一半崩了文件就坏 | `save()` 原子写(临时文件+move 覆盖)+ 自动保留历史备份 |
| 命令行想看一眼远端配置要 curl 拼 XML | `sc-webdav config-load/config-save` 等命令直达 |

## 3. 方案选择

### 方案 A:包装成熟库 `webdav`(npm,perry-mitchell/webdav-client v5.10.0)(采用)

- 优点:HTTP + PROPFIND + XML 解析、认证(Basic/Digest)、重定向等细节由成熟库处理,稳定性高、维护成本低,符合「优先采用成熟库」原则;自带 TS 类型。
- 缺点:引入第三方依赖(运行时可接受);库 API 偏底层(文件/字节),需要我们再封装一层配置语义。

### 方案 B:自研 HTTP + XML WebDAV 客户端(不采用)

- 优点:零第三方依赖。
- 缺点:PROPFIND 的 XML 解析、各类 WebDAV 服务(坚果云/Nextcloud)兼容性差异、分块/重定向等细节工作量大且易踩坑,不符合「不重复实现通用功能」。

### 高层配置封装(ConfigStore)设计取舍

- `save()` 采用**原子写**:先 PUT 临时文件 → `moveFile`(WebDAV 的 overwrite=true)覆盖目标,避免写一半损坏;旧版本在覆盖前备份为 `<name>.bak.N`(保留最近 N 份,默认 3)。
- 格式先支持 `json` 与 `text`(`json` 自动 `JSON.parse/stringify`);YAML 不引入解析依赖,需要时再议。

## 4. 仓库结构

```text
packages/webdav/
├─ src/
│  ├─ index.ts            公共出口
│  ├─ types.ts            连接配置/基础操作/ConfigStore 类型
│  ├─ errors.ts           WebdavError + 错误码 + 底层错误归类
│  ├─ client.ts           createWebdavClient(包装 webdav 库)
│  ├─ config-store.ts     ConfigStore(load/save/原子写/备份)
│  └─ cli/
│     └─ webdav.ts        sc-webdav CLI
├─ tests/
│  ├─ helpers/webdav-test-server.ts   本地 WebDAV 服务器(webdav-server)
│  ├─ client.test.ts      基础操作真实协议路径
│  ├─ config-store.test.ts 原子写/备份/格式
│  └─ cli.test.ts         CLI 命令冒烟
├─ package.json / tsconfig*.json / rollup.config.mjs / scripts/clean.mjs
└─ README.md
```

## 5. 接口设计

### 类型与枚举

```ts
// 连接配置:URL + 认证(基本认证优先,亦支持 token/无认证)
interface WebdavConnectionConfig {
  url: string;                 // 如 https://dav.jianguoyun.com/dav/
  username?: string;
  password?: string;           // 与 token 二选一
  token?: string;
  timeoutMs?: number;          // 默认 15000
}

interface WebdavFileStat {
  path: string;                // 相对 base 的路径,如 /configs/app.json
  name: string;
  type: "file" | "directory";
  size: number;
  lastModified: Date;
}

// ConfigStore 选项
interface ConfigStoreOptions {
  basePath?: string;           // 远端目录,默认 "/configs/"
  format?: "json" | "text";    // 默认 json
  backupCount?: number;        // 保留历史备份数,默认 3,0=不备份
}
```

### API 形状

```ts
import { createWebdavClient, ConfigStore } from "@sakurachiyo0v0/webdav";

// 1. 基础文件操作(薄封装 webdav 库,统一错误)
const wd = createWebdavClient({ url: "https://dav.example.com/dav/", username: "u", password: "p" });
await wd.ping();                                   // 连通性(列出根目录)
await wd.mkdir("/configs");                        // 建目录
const files = await wd.list("/configs");           // WebdavFileStat[]
await wd.put("/configs/app.json", JSON.stringify({ a: 1 }), { overwrite: true });
const text = await wd.get("/configs/app.json");    // string
await wd.move("/configs/app.json", "/configs/app.old.json");
await wd.copy("/configs/app.old.json", "/configs/app.json");
await wd.remove("/configs/app.old.json");
console.log(await wd.exists("/configs/app.json")); // boolean

// 2. 配置文件高层 API
const store = new ConfigStore({ client: wd, format: "json", backupCount: 3 });
const cfg = await store.load<{ a: number }>("app.json");   // 自动 JSON.parse;404 → 抛 NOT_FOUND
await store.save("app.json", { a: 2 });                    // 原子写 + 旧版自动备份 .bak.1/.bak.2/...
const names = await store.list();                          // ["app.json", ...]
await store.remove("app.json");
```

- 所有路径统一以 `/` 开头、相对 base URL;错误统一抛 `WebdavError`(消息脱敏,不泄露密码)。
- `get` 返回文本;二进制读取不在首版(配置场景用不到,需要再加 `getBinary`)。

## 6. 错误处理

| 错误码 | 含义 | 触发示例 |
| --- | --- | --- |
| `AUTHENTICATION` | 认证失败(401/403) | 密码/token 错 |
| `CONNECTION` | 网络/连接失败 | 服务器不可达、超时 |
| `NOT_FOUND` | 文件/目录不存在(404) | `get`/`remove` 不存在的文件 |
| `CONFLICT` | 冲突(409/412) | `put` 不覆盖时目标已存在 |
| `VALIDATION` | 参数非法 | 空 URL、非法路径 |
| `UNKNOWN` | 其他 | 服务端 5xx |

底层错误按 HTTP 状态码 + webdav 库错误归类;原始错误保留 `cause`。

## 7. 测试策略

- **真实协议路径**:测试 helpers 用 `webdav-server` 在本地端口起真实 WebDAV 服务器(支持 Basic 认证),客户端走完整 HTTP+XML。
- 基础操作:ping/mkdir/list/put/get/move/copy/remove/exists 往返;认证失败 → `AUTHENTICATION`;404 → `NOT_FOUND`;超时 → `CONNECTION`。
- ConfigStore:save→load 往返、JSON 解析、**原子写**(模拟目标已存在时覆盖)、**备份**(save 后旧版在 `.bak.1`,连续 save 滚动)、backupCount=0 不备份、list/remove。
- CLI:命令冒烟(指向本地测试服务器),JSON 输出。
- **写操作自清理**:测试在独立临时目录,收尾删除。

## 8. CLI 与 skill 同步

- 新增 CLI `sc-webdav`:
  - `ping` — 连通性检查
  - `list <path>` — 列目录
  - `get <path>` — 读文件(打印内容)
  - `put <path> [--file <本地路径> | --data <字符串>]` — 写文件
  - `delete <path>` — 删文件
  - `mkdir <path>` / `rmdir <path>` — 建/删目录
  - `move <src> <dst>` — 移动/重命名
  - `config-load <name>` / `config-save <name> [--file <本地> | --json <JSON>]` — 配置高层
  - 连接参数:`--url --username --password` 或环境变量 `WEBDAV_URL` / `WEBDAV_USERNAME` / `WEBDAV_PASSWORD`
- 同步 `skills/webdav-cli/SKILL.md`(命令集一致,守卫自动校验)。

## 9. 版本与发布

- 新包 `version: 0.1.0`,license `UNLICENSED`,`files` 只发 `dist` + `README.md`。
- 依赖:`webdav`(运行时)、`@sakurachiyo0v0/cli-utils`(CLI);devDeps 加 `webdav-server`(测试)。
- 接线:根 `package.json` `build` 追加;`scripts/publish-packages.mjs` 发布顺序追加 `webdav`(无包间依赖,放 database 后);`docs/packages-index.md` 总览与详情。
- 发布后 `pnpm verify:published @sakurachiyo0v0/webdav` 消费验证。

## 10. 验收条件

- [ ] spec 经用户批准
- [ ] 基础文件操作 + ConfigStore 最小示例跑通(本地 webdav-server)
- [ ] `pnpm --filter @sakurachiyo0v0/webdav typecheck && test` 全绿(真实协议路径)
- [ ] `pnpm --filter @sakurachiyo0v0/webdav build` 产出 ESM + CJS + d.ts
- [ ] CLI `sc-webdav` 可用,`skills/webdav-cli/SKILL.md` 同步
- [ ] README + packages-index 更新,根 build / publish 顺序接线
- [ ] `pnpm check` 全仓通过
- [ ] 用户确认后提交推送,CI 发布成功,`pnpm verify:published` 消费验证通过
