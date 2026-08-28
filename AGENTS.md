# AGENTS.md

本文件为在此仓库中工作的 AI 代理提供工作指南。目标:让代理高效、一致、不破坏仓库地完成改动。

## 仓库是什么

个人 TypeScript 开发工具 monorepo,用 pnpm workspace 组织。公开 GitHub 仓库 `SakuraChiyo0v0/ts-dev-kits`;包发布到 GitHub Packages,不发布到公共 npm registry。

- `packages/*` — 可复用依赖包(`@sakurachiyo0v0/<name>`;当前有 `cli-utils`、`account`、`email`、`ffmpeg`、`bilibili`、`netease-music`、`chat-platforms`、`lol`、`dsh-sdk-tools`)
- `docs/` — 设计文档、规范、包索引与模板
- `scripts/` — 仓库级验证脚本

## 常用命令

根目录或任意子包内运行(需 Node.js 20+、pnpm 11):

```powershell
pnpm install              # 安装全部 workspace 依赖
pnpm check                # typecheck + test + build 全仓验证
pnpm typecheck            # 递归类型检查
pnpm test                 # 递归运行测试
pnpm build                # 构建全部包(email + ffmpeg)
pnpm --filter @sakurachiyo0v0/email test    # 单包测试
pnpm --filter @sakurachiyo0v0/email build   # 单包构建
pnpm --filter @sakurachiyo0v0/ffmpeg test   # ffmpeg 包测试
pnpm --filter @sakurachiyo0v0/ffmpeg build  # ffmpeg 包构建
pnpm verify:email-package            # pack 后从临时消费项目验证导入
pnpm verify:email-git-package        # git 子目录依赖方式验证安装
pnpm verify:published @sakurachiyo0v0/<name>  # 发布后从 GitHub Packages 消费验证
```

## 功能开发流程

新增/修改 SDK 功能时按 **`docs/sdk-development-workflow.md`** 走完整流程:
设计 spec → 实现 → 测试 → 文档 → CLI+skill 同步 → 版本 bump → `pnpm check`
→ 提交(守卫自动拦)→ push → CI 发布 → `pnpm verify:published` 消费验证。

## 关键约定

### 环境

- Node.js >= 20,pnpm 11(packageManager 已锁定版本)。
- **不要在浏览器或 WebView 中保存 SMTP 密码。** SDK 只应在可信服务端进程运行。

### 包与构建

- 新依赖包按 `docs/package-template.md` 的结构创建;现有包清单见 `docs/packages-index.md`。
- 包名统一 `@sakurachiyo0v0/<name>`,license `UNLICENSED`,不发布公共 registry。
- 构建产出 ESM + CJS + `.d.ts`(`dist/`)。保持"只发 dist + README"约定,不要用 `exports` 暴露 `./src/*`。
- 包间依赖用 `workspace:*`(见模板「包间依赖」节)。依赖图保持单向无环,被依赖包先 build。

### 代码风格

- TypeScript 严格模式:继承根 `tsconfig.base.json`,开启 `exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 等。可选属性用展开 `...(x ? { x } : {})` 而非 `undefined` 赋值。
- 公共 API 保持供应商无关:核心接口定义在类型层,供应商适配器(如 SMTP)是可替换实现。新增供应商不改动上层接口。
- 错误处理:统一 `EmailError` + 错误码,公开消息与日志必须脱敏,不泄露 SMTP 用户名/密码、连接串。
- 测试优先走真实协议路径(本地 smtp-server),必要时用 fake provider 测校验与生命周期。

### Git 流程

- 提交信息用 conventional 风格(`feat:`、`fix:`、`docs:`、`refactor:` 等),英文。
- **提交身份必须使用 GitHub 账号的 `user.name` / `user.email`(即与 `SakuraChiyo0v0` 关联的身份),不要使用本地的公司账户。** 若环境未配置或存在多个身份,提交时用 `-c user.name=<GitHub 用户名> -c user.email=<GitHub 邮箱>` 显式指定。
- **未经用户明确说"提交"或"推送",不要执行 `git commit` / `git push`。** 改动留在工作区或本地分支,先向用户汇报,等确认后再提交。用户原话:"以后我没说提交先别提交哈"。
- 提交、推送、tag、发布是彼此独立的授权操作,不由构建/测试命令自动执行。未经用户确认不要 push。
- 修改后至少跑 `pnpm --filter <受影响包> typecheck && test`;改动涉及全仓时跑 `pnpm check`。

## 文档索引

- `README.md` — 项目总览、快速开始、版本约定
- `docs/sdk-development-workflow.md` — SDK 功能开发一条龙流程(设计→实现→测试→文档→skill→发布→验证)
- `docs/packages-index.md` — 依赖包总览表 + 每包详情
- `docs/package-template.md` — 新增依赖包的目录/文件/接线模板
- `docs/superpowers/` — 设计与实现文档(方案、验收条件);`specs/spec-template.md` 是 spec 模板
- `skills/` — CLI 使用手册(`<name>-cli/SKILL.md`),给 AI 的 CLI 操作指南
- 新增可复用包时:按模板创建,并更新 `docs/packages-index.md`。

## CLI 与 skill 联动

- 每个带 CLI 的包(`packages/<name>/src/cli/*.ts`)对应一个 `skills/<name>-cli/SKILL.md`。
- **SKILL.md 必须有 YAML frontmatter**(`name` + `description`,name 用 kebab-case)——DSH 的 `skill-filesystem` 靠它识别;缺 frontmatter 的 skill 会被 DSH 忽略(仅仓库内 CLI 校验不拦)。新增/修改 SKILL.md 时同步维护 frontmatter。
- **改了 CLI 命令(新增/改名/删除/参数/语义)必须同步 skill**,否则:
  - pre-commit 的 `scripts/check-skill-staleness.mjs` 会因命令集不一致**阻止提交**;
  - 参数/语义变化(命令名不变)会触发 mtime **警告**,需人工检查。
- 对照表(如编码 id)以源码 `types.ts` 枚举为权威,skill 只引用不另造。
- 确认为临时跳过可用 `git commit --no-verify`,但 skill 长期不同步会导致 AI 按旧手册操作出错。

## 已知环境注意事项

- 在 fuse 文件系统(用户挂载目录)上 `pnpm install` 可能极慢;需要安装/构建/测试时,可先复制到本地磁盘再操作,完成后只拷回必要产物。
- **11 位纯数字会被对话/终端显示层打码(中间 4 位变 `****`),疑似手机号保护。** 网易云歌单 id 恰为 11 位数字,会被误伤(如 `181****6754`)。数据本身完整,仅显示层行为;不要复制打码后的文本当参数传,需在脚本内部用完整 id(可逐字符打印绕过显示)。详见 `packages/netease-music/README.md`。
- **`user:pass@` 连接串会被显示层整体打码成星号。** 涉及数据库/API 连接串(如 `postgresql://root:***@host:5432/db`)时,不要直接写完整凭据进命令文本,用变量分片拼接绕过(如 `P1="abc"; P2="def"; URL="postgresql://${P1}${P2}@host/db"`);绝不复制对话里打码后的星号当参数传,典型报错 `SASL: client password must be a string` / `Access denied ... using password: NO`。凭据原文只来自用户口述/配置文件。
