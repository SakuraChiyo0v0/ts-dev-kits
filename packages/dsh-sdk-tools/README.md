# @sakurachiyo0v0/dsh-sdk-tools

DSH(DeepSeek Harness)host 插件:把本仓库功能包(bilibili / netease-music / ffmpeg / email / lol / vrchat)包装成 agent 工具,通过 **Agent 预设**按需暴露——选中预设的会话才有这些工具,其余会话零污染、0 token 开销。

## 适用环境

- Node.js 20+,已安装 DSH(`@deepseek-ai/dsh`,当前对齐 `0.1.1-rc.2`);
- 各功能包的真实前置条件依旧生效:bilibili/网易云/vrchat 需登录态(自动从 AuthStore 加载)、lol 需本机运行英雄联盟客户端、email 需配置 SMTP。

## ⚠️ 消费方式限制(重要)

本包是 **DSH host 插件**,只应作为 DSH profile 依赖安装使用(见下方「安装」),**不能从公共 npm registry 独立安装消费**(`npm i @sakurachiyo0v0/dsh-sdk-tools` 到普通项目会失败)。

原因:本插件的传递依赖 `@deepseek-ai/*`(cordis / dsh-tools / schemastery / dsh-invariants 等)当前只有 rc 预发布版本,**公共 npm 源上不存在满足 `>=0.1.x <0.2.0` 的稳定版本**,独立安装会报 `ERR_PNPM_NO_MATCHING_VERSION`。这是 @deepseek-ai 生态的既有状态,非本包缺陷。

正确的消费方式:通过 `dsh plugin --profile <name> add @sakurachiyo0v0/dsh-sdk-tools` 装进 DSH profile——DSH 自带完整的 @deepseek-ai rc 依赖树,能正常解析。发布到 GitHub Packages 只是为了在 DSH 内分发,不是给普通 npm 项目用的。

## 工作原理

- 本插件**不设 `dsh.bundle`**,是普通依赖:工具行由**预设**的 `agent.cordis.yml` 声明;
- 预设挂载时插件 `ctx.tools.register(defineTool(...))` 注册到该预设的 scope 层,只有加入该预设的 agent 可见(`agent-presets` 的 standing scope 机制);
- 每包有 `enabled` 开关,未启用即不注册 → 不进 system prompt;
- **设置页开关**:DSH 设置 →「SDK工具」页读写 `~/.dsh/settings.yaml` 的 `dsh-sdk-tools` 节(8 个扁平 `enabled`:bilibili / netease / ffmpeg / email / lol / vrchat / logs / kazumi)。切换实时生效——host 侧 watch 到变化即重新注册/注销对应工具,无需改 YAML、无需重启会话。预设 `agent.cordis.yml` 的 `config` 作为 entry(base)层提供各包参数与默认 enabled,settings 文档(user)层只覆盖 enabled。

## 安装

### 1. 把插件装进 DSH profile 依赖

**推荐:GitHub Packages(无需 token,仓库已公开)。** 项目或用户目录 `.npmrc` 加一行指向私有 registry:

```ini
@sakurachiyo0v0:registry=https://npm.pkg.github.com/
```

然后一条命令安装(需先在 GitHub Packages 发布,见仓库 `docs/GITHUB_PACKAGES.md`):

```powershell
npx -p @deepseek-ai/dsh dsh plugin --profile <name> add @sakurachiyo0v0/dsh-sdk-tools
```

> 插件的 `dependencies`(`@sakurachiyo0v0/*`)随 GitHub Packages 解析;`@deepseek-ai/*` 由 DSH 运行时提供(它自带完整的 rc 依赖树),因此本插件**只应装进 DSH profile**,不能独立安装到普通项目——见上文「⚠️ 消费方式限制」。

**仓库内开发时**可用本地路径安装:

```powershell
npx -p @deepseek-ai/dsh dsh plugin --profile <name> add <本仓库>/packages/dsh-sdk-tools
```

**跨机且未发布时**用 git 子目录依赖:

```powershell
npx -p @deepseek-ai/dsh dsh plugin --profile <name> add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/dsh-sdk-tools"
```

### 2. 复制预设到 DSH 用户预设目录

```powershell
# 把随包分发的预设模板复制到 DSH 数据目录(<dshHome>/.agent-presets/)
# npm 安装后模板位于 profile 的 node_modules 下:
Copy-Item -Recurse <profile>/node_modules/@sakurachiyo0v0/dsh-sdk-tools/presets/ts-dev-kits "$env:DSH_HOME/.agent-presets/"
# 仓库内开发时直接用源码目录:
Copy-Item -Recurse <本仓库>/packages/dsh-sdk-tools/presets/ts-dev-kits "$env:DSH_HOME/.agent-presets/"
```

若 `DSH_HOME` 未设置,默认用户预设目录在 DSH 数据目录下的 `.agent-presets/`(与 `dsh-skill-filesystem` 的 skills 同级)。

### 2.1 配置 CLI skill 手册(可选但推荐)

预设已挂载 `skill-filesystem` + `tool-skill`,让选中该预设的会话拥有 ts-dev-kits 仓库 `skills/` 下的 CLI 手册(`bilibili-cli` / `kazumi-cli` / `steam-cli` 等)。**唯一要做的**:把 `agent.cordis.yml` 里 `skill-filesystem` 行的 `customSkillDirs` 指向本机 ts-dev-kits 仓库的 `skills/` 绝对路径(不展开 `~`):

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - "/绝对路径/ts-dev-kits/skills"
```

> `skill-filesystem` / `tool-skill` 由 DSH host 基础组合内置(无需安装);`customSkillDirs` 只对选中本预设的会话生效,不影响其他预设。若不想配路径,也可把仓库 `skills/` 内容复制进 `~/.dsh/skills/`(全局可见)。

### 3. 重启 DSH,新建会话选择预设

新建会话时选择 `ts-dev-kits` 预设,即可使用下列工具;不选则工具完全不出现。

## 预设与工具清单

| 包 | 工具 | 默认 |
| --- | --- | --- |
| bilibili | `bilibili_parse` / `bilibili_download` | 开 |
| netease-music | 解析/下载:`netease_parse` / `netease_download` / `netease_status` / `netease_levels`;账号与收藏:`netease_account` / `netease_playlists` / `netease_likes` / `netease_check_liked` / `netease_like` / `netease_unlike`;歌单管理:`netease_playlist_add` / `netease_playlist_remove` / `netease_playlist_subscribe` / `netease_playlist_unsubscribe` / `netease_playlist_create` / `netease_playlist_delete` | 开 |
| ffmpeg | `ffmpeg_probe` / `ffmpeg_transcode` / `ffmpeg_extract_audio` / `ffmpeg_thumbnail` | 开 |
| email | `email_verify` / `email_send` | **关**(需配置 SMTP) |
| lol | `lol_summoner` / `lol_match_history` / `lol_ranked` | 开 |
| vrchat | `vrchat_whoami` / `vrchat_user` / `vrchat_worlds_search` | **关**(需本地 VRChat 登录态) |
| logs | `logs_query` — 查询 SDK 日志(等级/设备/命名空间/关键词/时间,跨机聚合) | 开 |
| kazumi | `kazumi_search` / `kazumi_roads` / `kazumi_download` — 番剧规则采集与下载(搜索/线路/下载 mp4) | 开 |

> 网易云账号/收藏/歌单类工具只操作**当前登录账号自己的收藏与歌单**(红心、增删歌、订阅/退订、创建/删除),不涉及他人内容;下载链路的权限预检与试听拦截硬规则仍由 SDK 强制。

## 配置

**设置页开关(推荐):** DSH 设置 →「SDK工具」页切换 8 个功能包开关,实时生效。写入 `~/.dsh/settings.yaml` 的 `dsh-sdk-tools` 节:

```yaml
dsh-sdk-tools:
  bilibili: true   # false = 关掉该包全部工具
  netease: true
  ffmpeg: true
  email: false
  lol: true
  vrchat: false
  logs: true
  kazumi: true
```

> settings 文档只承载 enabled 开关;各包参数仍由预设 `agent.cordis.yml` 的 `config` 提供(见下),避免敏感字段(SMTP 密码)进入设置文档。settings 未写入的包回退 entry 值。

**预设 entry 配置:** 预设的 `agent.cordis.yml` 中 `config` 即插件配置(schemastery schema,未填项取默认):

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `bilibili.enabled` / `outputDir` | `true` / `~/Downloads/bilibili` | 下载目录 |
| `netease.enabled` / `outputDir` / `level` | `true` / `~/Downloads/netease` / `exhigh` | 目标品质:`standard/higher/exhigh/lossless/hires` |
| `ffmpeg.enabled` | `true` | — |
| `email.enabled` / `smtp` | `false` / 无 | 配置 `smtp.host/port/secure/from`(可选 `user/pass`)后启用 |
| `lol.enabled` | `true` | — |
| `vrchat.enabled` | `false` | 需本机已保存 VRChat 登录态 auth.json(CLI `sc-vrchat login` 生成) |
| `logs.enabled` / `remote` / `local` | `true` / `true` / `false` | 日志查询:`remote` 查服务器 PostgreSQL(跨机聚合),`local` 查本机 SQLite |

**安全约定:** SMTP 密码等敏感配置只存在于 host 端预设 config,不进浏览器/WebView;工具返回与错误消息已脱敏(不包含 SMTP 密码 / cookie / 连接串)。

## 合规红线

netease-music 的硬规则在 SDK 层强制,工具层不绕过:无权限品质 → 拒绝不降级(`PRIVILEGE_DENIED`);试听片段 → 拒绝不落盘(`TRIAL_ONLY`)。

## 已知环境注意事项

- **11 位纯数字 id 会被显示层打码:** 对话/终端显示层会对连续 11 位纯数字(疑似手机号)自动把中间 4 位替换为 `****`。网易云歌单 id 恰好是 11 位数字,会被误伤(如 `181****6754`)。这**只是显示层行为,数据本身完整**——SDK 内部拿到的 id 一直是完整数字。**不要复制打码后的文本当参数传**(会解析失败);应在脚本内部用完整数字 id 操作,或让 agent 从工具返回中直接取用 id。详见 `packages/netease-music/README.md`。

## 开发

```powershell
pnpm --filter @sakurachiyo0v0/dsh-sdk-tools typecheck
pnpm --filter @sakurachiyo0v0/dsh-sdk-tools test      # 含 settings 接线真实组合测试
pnpm --filter @sakurachiyo0v0/dsh-sdk-tools build     # host: dist/;client 设置页: lib/client.js + d.ts
```

构建产物:
- `dist/` — host 半(tsc + rollup,ESM + CJS + d.ts);
- `lib/client.js` — client 设置页 bundle(tsdown,`window.__ModuleLoader__` 注册,react/cordis external);
- `lib/index.d.ts` / `lib/settings-page.d.ts` — client 类型(tsc)。

被依赖 SDK(ffmpeg、bilibili、netease-music、email、lol、vrchat)需先 `build`(仓库根 `pnpm build` 已按依赖顺序处理)。

## 新增功能包工具

1. 在 `src/tools/` 新建 `<pkg>.ts`,导出 `apply<Xxx>Tools(ctx, config)` 注册 `defineTool`,返回 disposer(收集各 `ctx.tools.register` 返回值);
2. 在 `src/config.ts` 增加该包 Config 字段;
3. 在 `src/capabilities.ts` 注册表加一行(受 `enabled` 控制);
4. 在 `src/settings.ts` 的 `SettingsSchema` / `toSettingsShape` / `applySettingsShape` 加对应开关;
5. 在 `src/client/settings-page.tsx` 的 `FEATURES` 加一行展示;
6. 补充 `tests/` 与本文档工具表。
