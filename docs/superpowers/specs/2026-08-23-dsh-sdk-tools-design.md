# DSH 功能包加载组件设计（Agent 预设方案）

状态:待用户审阅
日期:2026-08-23

## 1. 当前问题与目标

仓库已有 9 个功能包(`@sakurachiyo0v0/*`:bilibili、netease-music、ffmpeg、email、lol、account、bilibili-auth、chat-platforms、cli-utils),都是 Node SDK,能力完整但没有接入 DeepSeek Harness(DSH)。用户在 DSH 里想让 agent 直接调用这些 SDK,但**大部分功能只有特定场景才用,不希望常驻工具列表干扰上下文、消耗 token**。

经与用户确认,方案定为 **Agent 预设(方案 A)**:新建一个 DSH 插件包,把本仓库功能包包装成 agent 工具;再提供一个专门的预设,选中该预设的会话才拥有全套功能包工具,其余会话(默认"标准模式")完全不受影响、零额外 token。

本次目标:

- `packages/dsh-sdk-tools` — DSH host 插件包:把 bilibili、netease-music、ffmpeg、email、lol 包装成 `defineTool` 工具;
- 随包分发一个预设模板 `ts-dev-kits`:挂载 dsh-sdk-tools 并启用全部功能包,作为"专门使用本仓库包能力的 agent"组合。

**明确不做(首期):** 会话内动态启用(`enable_capability` 管理器)、client/Web 面、修改 DSH 本体、改造 chat-platforms / cli-utils / account / bilibili-auth 为独立工具(它们是底座或被依赖方,见 §4.3)。

## 2. 用户可见的前后变化

| 当前情况 | 完成后 |
| --- | --- |
| DSH 里没有任何本仓库能力 | 新建会话时可选择 `ts-dev-kits` 预设,该会话拥有 bilibili / 网易云 / ffmpeg / lol 工具(以及配置 SMTP 后启用的 email 工具) |
| 功能包能力不可被 agent 直接调用 | agent 可直接调 `bilibili_download`、`netease_download`、`email_send`、`ffmpeg_transcode`、`lol_match_history` 等 |
| 担心工具常驻耗 token | 不选 `ts-dev-kits` 预设的会话(标准模式)完全看不到这些工具,0 token 开销 |
| 登录态/配置散落 | 复用各 SDK 既有登录态存储(account/bilibili-auth 的 AuthStore);SMTP 等敏感配置只进 host 端预设 config |

## 3. 方案选择

### 3.1 Agent 预设(采用,已与用户确认)

| 方案 | 结论 |
| --- | --- |
| **Agent 预设**:预设 = `<dshHome>/.agent-presets/<id>/` 目录(含 `agent.cordis.yml` 插件行),选中预设的会话才看到该预设 scope 层注册的工具 | **采用**:DSH 原生作用域隔离;不选 = 完全不注册 = 0 token;GUI 原生支持预设选择 |
| `enable_capability` 管理器工具 | 不用:始终占用 1 个工具;依赖模型判断;用户明确不选 |
| 全部工具全局注册 | 不用:所有会话常驻工具,违背"平时不污染上下文"诉求 |

### 3.2 插件包形态:host-only,不设 `dsh.bundle`(采用)

- 工具、配置、登录态读取都是 host 能力,无 Web 可视化需求 → **不声明 `dsh.client`**,不构建 client bundle;
- 预设行的**包名从 profile 依赖解析**(`agent-presets` 的 `PresetTree.import` 以 host 组合的 base 解析裸包名),因此插件装进 profile 依赖即可,`dsh.bundle.patch` 不是必需;
- 插件 `apply(ctx)` 里 `ctx.tools.register(defineTool(...))` 注册到**当前 scope 层**——预设挂载时 ctx 带 preset scope key,工具只对加入该预设的 agent 可见(`mount.ts` 的 scope 机制已确认);
- 预设行**不能发布 root-realm 全局 service**(`mount.ts` 的 `leakedServices` 检查):本插件只注册工具与 system prompt section,不发布 service,天然合规。

### 3.3 构建:沿用仓库 rollup 双格式(采用)

与现有包一致:`tsconfig.bundle.json`(ESM,供 rollup)+ `rollup.config.mjs`(ESM + CJS)+ `tsconfig.build.json`(d.ts)。`exports` 指向 `dist/index.js`(ESM)与 `dist/index.cjs`。peer 依赖不打包(rollup external)。

### 3.4 peer 依赖版本:对齐 DSH `0.1.1-rc.2`(采用)

DSH 官方当前版本 `0.1.1-rc.2`(npm `@deepseek-ai/dsh` dist-tags 确认)。peer 依赖版本以 `@deepseek-ai/dsh-tools@0.1.1-rc.2` 的声明为准:其 peer 是 `@deepseek-ai/cordis@^4.0.1-rc` 系、自身依赖 `@deepseek-ai/schemastery@^3.18.1-rc` 系(npm 已发布,可直接安装,不写死本机路径)。peer 声明避免复制 runtime identity;devDependencies 装同版本用于本地类型检查与测试。

## 4. 架构与数据流

### 4.1 插件包结构

```
packages/dsh-sdk-tools/
├─ src/
│  ├─ index.ts             插件入口:name / inject / Config schema / apply(ctx, config)
│  ├─ config.ts            schemastery schema:每包 enabled 开关 + 参数(SMTP、输出目录…)
│  ├─ capabilities.ts      包名 → 工具注册函数 的注册表;按 config.enabled 过滤
│  ├─ tools/
│  │  ├─ bilibili.ts       bilibili_parse / bilibili_download
│  │  ├─ netease.ts        netease_parse / netease_download / netease_status
│  │  ├─ ffmpeg.ts         ffmpeg_probe / ffmpeg_transcode / ffmpeg_extract_audio / ffmpeg_thumbnail
│  │  ├─ email.ts          email_verify / email_send
│  │  └─ lol.ts            lol_summoner / lol_match_history / lol_ranked
│  └─ errors.ts            SDK 错误 → 工具错误消息的统一映射(脱敏)
├─ presets/
│  └─ ts-dev-kits/
│     ├─ agent.cordis.yml  一行:挂载 @sakurachiyo0v0/dsh-sdk-tools;config 默认启用 bilibili/netease/ffmpeg/lol,email 默认关(配置 smtp 后手动开)
│     └─ preset.yml        显示名/描述
├─ tests/                  Vitest
├─ package.json / tsconfig*.json / rollup.config.mjs / README.md
```

### 4.2 预设安装路径

预设由用户复制到 `<dshHome>/.agent-presets/ts-dev-kits/`(dshHome 为 DSH 数据目录;`agent-presets` 默认把 `<dshHome>/.agent-presets` 追加为 user root)。README 提供精确复制命令;预设目录可随包分发,不依赖 bundle 层。

### 4.3 依赖方向(单向无环)

```
dsh-sdk-tools ──workspace:*──▶ bilibili ──▶ bilibili-auth, ffmpeg
                          ──▶ netease-music ──▶ account, ffmpeg
                          ──▶ ffmpeg
                          ──▶ email
                          ──▶ lol
```

- account / bilibili-auth 是**底座**,被 bilibili / netease-music 内部复用(登录态自动加载、-101 自动续期),不单独暴露为工具;
- chat-platforms(服务端长连接)、cli-utils(CLI 解析辅助)首期不做工具;
- 被依赖 SDK 先 `build`(仓库根 build 已按依赖顺序排列);dsh-sdk-tools 的构建加入根 `build` 脚本末尾。

### 4.4 数据流(以 bilibili_download 为例)

```
agent 调 bilibili_download(url)
 → createBilibiliClient({ download: { outputDir: <config.outputDir> } })
   (未传 cookie 时自动从 bilibili-auth AuthStore 加载;API -101 自动 refreshCookies 续期)
 → client.parse(url) → MediaItem[]
 → client.download(item, { outputDir, quality, onProgress })
 → 返回 { filePath } → output.render 输出模型可读文本(文件路径、时长、清晰度)
```

## 5. 接口设计

### 5.1 插件 Config(schemastery)

```ts
export const Config = z.object({
  bilibili: z.object({
    enabled: z.boolean().default(true),
    outputDir: z.string().default('~/Downloads/bilibili'),
  }).default({}),
  netease: z.object({
    enabled: z.boolean().default(true),
    outputDir: z.string().default('~/Downloads/netease'),
    level: z.string().default('exhigh'),
  }).default({}),
  ffmpeg: z.object({ enabled: z.boolean().default(true) }).default({}),
  email: z.object({
    enabled: z.boolean().default(false),   // 需先配置 SMTP,默认关
    smtp: z.object({
      host: z.string(), port: z.number().default(587), secure: z.boolean().default(false),
      user: z.string().optional(), pass: z.string().optional(), from: z.string(),
    }).optional(),
  }).default({}),
  lol: z.object({ enabled: z.boolean().default(true) }).default({}),
})
```

- 每包 `enabled` 决定是否注册工具;未启用的包不注册 → 不进 system prompt;
- email 默认关:无 SMTP 配置时启用会暴露不可用工具,默认关、配置了 smtp 再开;
- 敏感配置(SMTP 密码)只存在于 host 端 preset config,遵守仓库"不在浏览器/WebView 保存 SMTP 密码"约定。

### 5.2 工具清单(defineTool,首期)

| 工具 | 参数(要点) | 输出 schema 要点 | 失败语义 |
| --- | --- | --- | --- |
| `bilibili_parse` | `url: string` | `items: MediaItem[]` | 解析失败 → 明确错误码消息 |
| `bilibili_download` | `url: string`, `output_dir?`, `quality?` | `{ filePath, quality }` | 未登录 → 提示先扫码登录(`LOGIN_REQUIRED`) |
| `netease_parse` | `url: string` | `songs: SongItem[]` | 同上 |
| `netease_download` | `url: string`(或 song id), `level?`, `output_dir?` | `{ filePath, level, lyricPath?, coverPath? }` | 越权品质 → `PRIVILEGE_DENIED`;试听特征 → `TRIAL_ONLY` 拒绝(硬规则,不降级) |
| `netease_status` | 无 | `{ loggedIn }` | 登录态检查,引导 login |
| `ffmpeg_probe` | `input: string` | `{ format, duration, streams }` | 文件不存在/非媒体 → `NOT_FOUND`/`INVALID_INPUT` |
| `ffmpeg_transcode` | `input`, `output`, `video_codec?`, `audio_codec?` | `{ outputPath }` | 进程失败 → `PROCESS_ERROR`(含 ffmpeg stderr 摘要) |
| `ffmpeg_extract_audio` | `input`, `output?`, `format?` | `{ outputPath }` | 同上 |
| `ffmpeg_thumbnail` | `input`, `output?`, `time?` | `{ outputPath }` | 同上 |
| `email_verify` | 无(用 config 的 smtp) | `{ ok }` | 连接/认证失败 → `AUTHENTICATION`/`CONNECTION`,消息脱敏 |
| `email_send` | `to: string[]`, `subject`, `text?`/`html?`, `attachments?` | `{ messageId }` | 校验/投递失败 → 对应错误码,脱敏 |
| `lol_summoner` | `name?` | `{ summoner }` | 客户端未运行 → `CLIENT_NOT_RUNNING` |
| `lol_match_history` | `name?`, `count?` | `{ matches }` | 同上 |
| `lol_ranked` | `name?` | `{ ranked }` | 同上 |

工具实现遵循 DSH 官方模板(`packages/fs/tool-fs`):

- `ctx.tools.register(defineTool({ name, description, parameters, output: { schema, render } }))`;
- `parameters` 用 dsh-tools 的 value-schema DSL(必填内联 `required: true`);`output.schema` 声明 canonical 返回值,注册时被 `assertSupportedJsonSchema` 校验;
- `output.render` 给模型稳定、紧凑、可判定的文本(文件路径、时长、清晰度,不吐 cookie/密钥);
- 异步工作转发 `exec.signal`(下载/转码可被取消),写操作幂等或冲突可预期(输出目录存在即复用,不静默覆盖);
- 工具名带 SDK 前缀,避免与 DSH 内置工具(read/write/bash…)冲突。

### 5.3 错误映射(errors.ts)

统一把 SDK 错误码翻译成工具可读消息并脱敏:

| SDK 错误码(示例) | 工具返回 |
| --- | --- |
| `LOGIN_REQUIRED` / `AUTH_EXPIRED` | "需要登录:请先运行扫码登录(bilibili/网易云)" |
| `PRIVILEGE_DENIED` | "当前账号无权请求该品质,已拒绝(不降级)" |
| `TRIAL_ONLY` | "返回的是试听片段,已拒绝下载完整音频" |
| `CLIENT_NOT_RUNNING` | "英雄联盟客户端未运行,请先启动" |
| 其余 | 错误码 + 脱敏后的摘要(不包含 SMTP 密码 / cookie / 连接串) |

## 6. 安全与边界

- **敏感配置只进 host 端 preset config**:SMTP 密码、B 站 cookie 不进入模型可见内容与浏览器;
- **netease 合规红线沿用 SDK 硬规则**:`TRIAL_ONLY` / `PRIVILEGE_DENIED` 在 SDK 层强制,工具层不新增绕过路径、不降级;
- **工具不发布 service**:只注册工具与 system prompt section,满足 `mount.ts` 的 `leakedServices` 检查;
- **作用域隔离是核心安全属性**:工具只出现在选中 `ts-dev-kits` 预设的会话;标准模式会话连工具名都看不到;
- 下载/转码的 `outputDir` 默认指向用户配置目录下的 Downloads,可经 preset config 覆盖,不用 `process.cwd()` 散落数据;config 里的 `~` 由工具层展开为用户主目录后再传给 SDK。

## 7. 测试

- **unit(默认跑):**
  - Config schema:各包 enabled 默认值、email 默认关、smtp 缺省校验;
  - 错误映射:构造各 SDK 错误码 → 断言工具返回消息与脱敏;
  - 工具参数校验:必填/缺省/非法参数;
  - 预设模板:`agent.cordis.yml` 能被 `entryListSchema` 解析且只含合法插件行,`preset.yml` 元数据格式正确;
- **真实组合(手工验证):**
  - 临时 scratch profile:`dsh plugin --profile <scratch> add <pkg 路径>` 安装插件包依赖(插件不设 `dsh.bundle`,是普通依赖,不在 bundle 层;验证依赖安装以 profile 的 `package.json`/lockfile 为准,`--dump-config` 用于确认 profile 基础层正常);
  - 复制 `presets/ts-dev-kits` 到 `<dshHome>/.agent-presets/`;
  - 启动 DSH(web profile):新建会话选 `ts-dev-kits` 断言工具可见、选标准模式断言不可见;
  - 真实任务:`dsh --profile headless "用 bilibili_parse 解析这个链接"` 之类小任务验证工具可被调用;
- **从零安装验证:** git 子目录依赖方式安装插件包 + 预设复制全流程,README 命令与实际一致。

## 8. 明确不做(YAGNI)

- 会话内动态启用(`enable_capability` 管理器工具);
- client/Web 可视化(工具开关 UI、预设管理 UI);
- 修改 DSH 本体 / 打补丁;
- chat-platforms、cli-utils、account、bilibili-auth 首期不做独立工具(底座或被依赖方);
- 每包多组工具精细拆解(lol 全量 API 只取查询三件套;ffmpeg 只取高频四件);
- 预设自动安装脚本(首期用复制命令,README 说明;后续可评估 `dsh plugin` 扩展或安装脚本)。

## 9. 依赖

- `dependencies`(workspace:*):`@sakurachiyo0v0/bilibili`、`@sakurachiyo0v0/netease-music`、`@sakurachiyo0v0/ffmpeg`、`@sakurachiyo0v0/email`、`@sakurachiyo0v0/lol`;
- `peerDependencies`: `@deepseek-ai/dsh-tools@^0.1.1-rc.2`、`@deepseek-ai/schemastery@^3.18.1-rc.4`、`@deepseek-ai/cordis@^4.0.1-rc.4`(npm 可装,不写死本机路径;以 `dsh-tools@0.1.1-rc.2` 的 peer/dependency 声明为准);
- `devDependencies`:同版本 peer + vitest;rollup 对 peer 与 workspace 依赖全部 external。

## 10. 后续可扩展性

- **新增功能包工具**:`capabilities.ts` 注册表加一行 + 新建 `tools/<pkg>.ts`,每包一个文件,成本低;
- **新增预设组合**:复制 `presets/ts-dev-kits` 目录改 config(如只开 email 的 `office` 预设),随包分发即可;
- **DSH 版本演进**:peer 版本随 DSH 正式版升级;插件只依赖 `dsh-tools` 稳定 API,无 DSH 内部耦合;
- 文档:`docs/packages-index.md` 总览表追加 `dsh-sdk-tools` 一行并补详情。

## 11. 验证清单

- [ ] `pnpm --filter @sakurachiyo0v0/dsh-sdk-tools typecheck && test && build` 通过;
- [ ] 被依赖 SDK(ffmpeg、bilibili、netease-music、email、lol)已 build;
- [ ] `pnpm check` 全仓通过;
- [ ] scratch profile:`dsh plugin add` 成功、插件依赖进入 profile lockfile;`--dump-config` 正常输出基础层;`ts-dev-kits` 预设被 `agent-presets` 发现(无 broken);
- [ ] 预设复制后,`ts-dev-kits` 会话工具可见、标准模式会话不可见(真实浏览器验证);
- [ ] headless 小任务真实调用 1-2 个工具(如 `bilibili_parse`);
- [ ] `docs/packages-index.md` 已更新;
- [ ] README 安装命令与预设复制命令与实际一致。
