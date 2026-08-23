# @sakurachiyo0v0/dsh-sdk-tools

DSH(DeepSeek Harness)host 插件:把本仓库功能包(bilibili / netease-music / ffmpeg / email / lol / vrchat)包装成 agent 工具,通过 **Agent 预设**按需暴露——选中预设的会话才有这些工具,其余会话零污染、0 token 开销。

## 适用环境

- Node.js 20+,已安装 DSH(`@deepseek-ai/dsh`,当前对齐 `0.1.1-rc.2`);
- 各功能包的真实前置条件依旧生效:bilibili/网易云/vrchat 需登录态(自动从 AuthStore 加载)、lol 需本机运行英雄联盟客户端、email 需配置 SMTP。

## 工作原理

- 本插件**不设 `dsh.bundle`**,是普通依赖:工具行由**预设**的 `agent.cordis.yml` 声明;
- 预设挂载时插件 `ctx.tools.register(defineTool(...))` 注册到该预设的 scope 层,只有加入该预设的 agent 可见(`agent-presets` 的 standing scope 机制);
- 每包有 `enabled` 开关,未启用即不注册 → 不进 system prompt。

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

> 插件的 `dependencies`(`@sakurachiyo0v0/bilibili` 等)也随 GitHub Packages 解析;peer 依赖 `@deepseek-ai/*` 仍走公共 npm,无需额外配置。

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

> 网易云账号/收藏/歌单类工具只操作**当前登录账号自己的收藏与歌单**(红心、增删歌、订阅/退订、创建/删除),不涉及他人内容;下载链路的权限预检与试听拦截硬规则仍由 SDK 强制。

## 配置

预设的 `agent.cordis.yml` 中 `config` 即插件配置(schemastery schema,未填项取默认):

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `bilibili.enabled` / `outputDir` | `true` / `~/Downloads/bilibili` | 下载目录 |
| `netease.enabled` / `outputDir` / `level` | `true` / `~/Downloads/netease` / `exhigh` | 目标品质:`standard/higher/exhigh/lossless/hires` |
| `ffmpeg.enabled` | `true` | — |
| `email.enabled` / `smtp` | `false` / 无 | 配置 `smtp.host/port/secure/from`(可选 `user/pass`)后启用 |
| `lol.enabled` | `true` | — |
| `vrchat.enabled` | `false` | 需本机已保存 VRChat 登录态 auth.json(CLI `amechan-vrchat login` 生成) |

**安全约定:** SMTP 密码等敏感配置只存在于 host 端预设 config,不进浏览器/WebView;工具返回与错误消息已脱敏(不包含 SMTP 密码 / cookie / 连接串)。

## 合规红线

netease-music 的硬规则在 SDK 层强制,工具层不绕过:无权限品质 → 拒绝不降级(`PRIVILEGE_DENIED`);试听片段 → 拒绝不落盘(`TRIAL_ONLY`)。

## 已知环境注意事项

- **11 位纯数字 id 会被显示层打码:** 对话/终端显示层会对连续 11 位纯数字(疑似手机号)自动把中间 4 位替换为 `****`。网易云歌单 id 恰好是 11 位数字,会被误伤(如 `181****6754`)。这**只是显示层行为,数据本身完整**——SDK 内部拿到的 id 一直是完整数字。**不要复制打码后的文本当参数传**(会解析失败);应在脚本内部用完整数字 id 操作,或让 agent 从工具返回中直接取用 id。详见 `packages/netease-music/README.md`。

## 开发

```powershell
pnpm --filter @sakurachiyo0v0/dsh-sdk-tools typecheck
pnpm --filter @sakurachiyo0v0/dsh-sdk-tools test
pnpm --filter @sakurachiyo0v0/dsh-sdk-tools build   # ESM + CJS + d.ts
```

被依赖 SDK(ffmpeg、bilibili、netease-music、email、lol、vrchat)需先 `build`(仓库根 `pnpm build` 已按依赖顺序处理)。

## 新增功能包工具

1. 在 `src/tools/` 新建 `<pkg>.ts`,导出 `apply<Xxx>Tools(ctx, config)` 注册 `defineTool`;
2. 在 `src/config.ts` 增加该包 Config 字段;
3. 在 `src/capabilities.ts` 注册表加一行(受 `enabled` 控制);
4. 补充 `tests/` 与本文档工具表。
