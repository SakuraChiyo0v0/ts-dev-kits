# `@sakurachiyo0v0/config` 配置中心 SDK 设计

状态:起草中(批准后改为「用户已批准」)
日期:2026-08-24

## 1. 当前问题与目标

- 现状:各 SDK(小黑盒/B站/网易云/Steam 等)的配置与登录态分散处理——本地 AuthStore 存文件,配置各写各的;想要"换台电脑配好密钥就能还原配置/登录态"需要每个 SDK 各自接 WebDAV + 加密,重复配置、重复实现。
- 目标:新增 `@sakurachiyo0v0/config` 配置中心 SDK——**WebDAV 服务器 + 密钥全局只配置一次**,各 SDK 通过 `namespace("平台名")` 存取自己的配置;命名空间自动隔离路径,**按域决定是否加密**;登录态/敏感配置加密上云,普通配置明文;新设备配好全局配置即还原。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| 每个 SDK 各自处理配置,换机要重新登录/重配 | 全局配一次 WebDAV+密钥,各 SDK `namespace` 即用,新机还原 |
| 登录态只存本地文件,多端不同步 | 登录态经加密存储上云,多端同步(密文) |
| 加密逻辑散落/重复 | 配置中心统一:命名空间 + 加解密开关一行决定 |

## 3. 方案选择

### 方案 A:独立 `@sakurachiyo0v0/config` 包,依赖 webdav 包(采用)

- 优点:配置中心与传输/加密原语分离(`config` 依赖 `webdav`),各 SDK 只依赖 `config`;一次全局配置、namespace 自动映射路径;复用已发布 webdav 的 ConfigStore/EncryptedConfigStore,不重复造轮子。
- 缺点:多一层依赖(可接受,层次清晰)。

### 方案 B:直接在 webdav 包里加 namespace 层(不采用)

- 优点:少一个包。
- 缺点:webdav 是通用传输层,不该知道"平台/命名空间"这种应用语义;各 SDK 仍要自己管理连接与密钥,没有"全局一次配置"。

### 全局配置存储位置取舍

- 全局配置(WebDAV 地址/账号/密钥)**存本地文件** `~/.config/amechan/config.json`(chmod 600,密钥不出本机),CLI `config setup` 写入;`createConfigCenter()` 自动读取。不放进 WebDAV(避免密钥上云)。
- 支持环境变量覆盖(`AME_CONFIG_HOME` 等)便于测试/多配置。

### 加密策略取舍

- `namespace(name, { encrypt })`:encrypt 默认 **false**(普通配置),敏感域(登录态等)显式 `encrypt: true` 走加密存储——"敏感才加密"原则,避免密钥丢失导致非敏感数据也读不了。
- 路径映射:`encrypt` → `/amechan/secrets/<name>/`,`false` → `/amechan/configs/<name>/`。

## 4. 仓库结构

```text
packages/config/
├─ src/
│  ├─ index.ts            公共出口
│  ├─ types.ts            全局配置/命名空间/配置中心类型
│  ├─ errors.ts           ConfigError(本地配置/校验)+ 透传 WebdavError
│  ├─ global-config.ts    本地全局配置读写(setup/load,chmod600)
│  ├─ config-center.ts    createConfigCenter / namespace 实现
│  └─ cli/config.ts       sc-config CLI
├─ tests/
│  ├─ helpers/            (复用 webdav 包测试服务器的模式,本地起 webdav-server)
│  ├─ global-config.test.ts
│  ├─ config-center.test.ts  真实协议路径
│  └─ cli.test.ts
├─ package.json / tsconfig*.json / rollup.config.mjs / scripts/clean.mjs
└─ README.md
```

## 5. 接口设计

### 类型与枚举

```ts
// 本地全局配置(chmod600):WebDAV 连接 + 加密密钥(本地保管)
interface GlobalConfig {
  url: string;
  username?: string;
  password?: string;
  key?: string;            // 加密密钥(可省略,用环境变量 WEBDAV_CONFIG_KEY)
}

interface ConfigCenterOptions {
  configPath?: string;     // 全局配置路径(默认 <配置根>/amechan/config.json)
  global?: GlobalConfig;   // 显式传入(不读文件)
}

interface NamespaceOptions {
  encrypt?: boolean;       // 默认 false;true=加密存储
}
```

### API 形状

```ts
import { createConfigCenter } from "@sakurachiyo0v0/config";

// 1. 全局配置(本地文件,自动读取;也可显式传 global)
const cc = await createConfigCenter();          // 读 ~/.config/amechan/config.json

// 2. 命名空间:平台/模块配置域,路径自动隔离
const xhh = cc.namespace("xiaoheihe", { encrypt: true });   // /amechan/secrets/xiaoheihe/*
await xhh.set("auth", { cookie: "..." });        // 加密存取
const auth = await xhh.get<{ cookie: string }>("auth");

const bili = cc.namespace("bilibili");           // /amechan/configs/bilibili/* (明文)
await bili.set("ui", { quality: 80 });
const names = await bili.list();
await bili.remove("ui");
```

- `ConfigCenter.namespace(name, opts?)` → `ConfigNamespace`
- `ConfigNamespace.get/set/list/remove`(语义与 ConfigStore 一致,key 即文件名,防路径越界)
- 错误:远端错误透传 `WebdavError`(调用方已熟悉);本地配置缺失/非法抛 `ConfigError`(`VALIDATION`,"未配置,请先 config setup")

### CLI(`sc-config`)

- `setup [--url ...] [--username ...] [--password ...] [--key ...]` — 写入本地全局配置
- `status` — 显示配置状态(地址/账号,密码密钥脱敏)
- `get <namespace> <key> [--encrypt]` / `set <namespace> <key> [--json <JSON>|--file <path>] [--encrypt]`
- `list <namespace> [--encrypt]` / `remove <namespace> <key> [--encrypt]`
- 连接/密钥从本地全局配置读取,无需每次传参

## 6. 错误处理

| 错误码 | 含义 | 触发示例 |
| --- | --- | --- |
| `VALIDATION` | 本地配置缺失/非法 | 未 setup 就 createConfigCenter、非法路径 |
| `CONNECTION` | WebDAV 连接失败 | 服务器不可达 |
| `AUTHENTICATION` | 认证失败 | 账号密码错 |
| `NOT_FOUND` | 配置不存在 | get 不存在的 key |
| `DECRYPTION` | 解密失败 | 密钥错、密文损坏 |
| `CONFLICT` | 冲突 | 不覆盖写已存在 |

(远端错误透传 webdav 的 `WebdavError`,本地配置错误用 `ConfigError` 同码。)

## 7. 测试策略

- **真实协议路径**:测试 helper 本地起 `webdav-server`(复用 webdav 包测试模式)。
- 全局配置:setup 写入/load/权限 600/缺失报错;环境变量覆盖配置路径。
- 配置中心:namespace 明文/加密两域存取往返、路径隔离(`/amechan/configs/<ns>/` vs `/amechan/secrets/<ns>/`)、加密域密文不含明文、list/remove、防路径越界。
- CLI:setup/status/get/set/list/remove 冒烟(指向本地服务器)。
- 写操作自清理:临时命名空间,收尾删除。

## 8. CLI 与 skill 同步

- 新增 CLI `sc-config`:`setup / status / get / set / list / remove`(带 `--encrypt`/`--namespace` 语义)。
- 同步 `skills/config-cli/SKILL.md`(命令集一致,守卫自动校验)。

## 9. 版本与发布

- 新包 `version: 0.1.0`,依赖 `@sakurachiyo0v0/webdav`(workspace)、`@sakurachiyo0v0/cli-utils`。
- 接线:根 `build`、`publish-packages.mjs` 顺序(config 依赖 webdav,放 webdav 后)、`docs/packages-index.md`。
- 发布后 `pnpm verify:published @sakurachiyo0v0/config`。

## 10. 验收条件

- [ ] spec 经用户批准
- [ ] 最小闭环:全局配置一次 → 两个 namespace(明文/加密)存取 → 真实 WebDAV 验证
- [ ] `pnpm --filter @sakurachiyo0v0/config typecheck && test` 全绿
- [ ] CLI + skill 同步,`pnpm check` 全仓通过
- [ ] README + packages-index + 接线完成
- [ ] 用户确认后提交推送,CI 发布成功,消费验证通过
