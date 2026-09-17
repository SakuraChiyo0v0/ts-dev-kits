# 工具库边界

`ts-dev-kits` 维护可复用 TypeScript/Node.js 工具包，发布到 GitHub Packages，供其他项目安装。应用需求可以驱动工具演进，但应用本身不进入本仓库。

## 收录范围

| 目录 | 职责 |
| --- | --- |
| `packages/` | 平台 SDK、通用功能、基础设施；每包有独立版本、公开导出和测试 |
| `examples/`（按需新增） | 最小 SDK 调用示例，不承载产品页面、账号体系或长期运行的服务 |
| `skills/` | 已有 CLI 的使用说明，不承载宿主插件实现 |
| `scripts/` | 构建、边界检查、发布、消费验证 |
| `docs/` | 当前接口约定与维护手册；历史设计明确标记适用时间 |

成熟 Web 应用、独立浏览器服务、应用部署配置、DSH 等宿主专用插件不进入主分支。其他项目通过包的公开导出使用能力，不跨目录引用 `src/`。

## 职责分类

保留 `packages/<包名>` 平铺；分类只组织导航，不移动目录、不改变包名和导入路径。

| 分类 | 包 |
| --- | --- |
| 通用基础 | logger、cli-utils |
| 存储与配置 | config、config-webdav、config-pg、webdav、database |
| 账号认证 | account |
| 媒体与通用工具 | ffmpeg、media-downloader、chuanshengtong、email |
| 平台 SDK | bilibili、netease-music、booth、steam、vrchat、xiaoheihe、lol、ugreen、chat-platforms、kazumi |

分类元数据在 `scripts/package-groups.mjs`；版本、公开入口与使用说明见 [包索引](packages-index.md)。分类覆盖全部包且不可重复。

## 依赖方向

职责相同不代表可以任意互相依赖。运行时内部依赖按以下规则检查：

| 来源 | 可以依赖 |
| --- | --- |
| logger | 不依赖其他仓库内包 |
| cli-utils | logger |
| config 核心 | logger |
| webdav | logger、cli-utils |
| config-webdav | config、webdav、logger、cli-utils |
| config-pg | config、logger |
| account | logger；远端通过接口注入，不依赖配置实现或平台 SDK |
| database | 通用基础、存储与配置；保留现有 WebDAV 自动读取功能 |
| 媒体与通用工具 | 通用基础、同类通用工具 |
| 平台 SDK | 通用基础、存储与配置、账号认证、媒体与通用工具；不互相依赖其他平台 SDK |

所有运行依赖仍须无环，被依赖包先构建、先发布。`dependencies`、`optionalDependencies`、`peerDependencies` 都受检查；`devDependencies` 允许跨层，用于真实适配器集成测试。本检查约束 manifest 中的仓库内依赖，不声称检查了源码跨目录导入或所有第三方驱动；安装减重由独立消费验收验证。

`pnpm check:boundaries` 检查分类覆盖、依赖方向及发布顺序，已接入 `pnpm check`。新增包需登记分类和发布清单；新增依赖先判断边界，不能为了通过检查随意扩大允许范围。config 1.0 的后端拆分与旧入口迁移见 [迁移说明](config-backends-migration.md)。

## 开发与发布

1. 按实际使用场景增加或修改工具，不要求每个包都有 CLI 或 AI 入口。
2. 包加入 `scripts/packages-list.mjs` 和 `scripts/package-groups.mjs`，同步分类导航、包索引和使用文档。
3. 运行 `pnpm check`：边界、构建、类型、测试、CLI 和文档索引检查。
4. 发布性修改按语义化版本更新；提交、推送、发布分别需要授权。
5. 现有 CI 在获授权推送到 `main` 后发布有版本变化的包；外部项目固定版本安装，再验证消费结果。

## 备份和恢复

- 备份分支：`backup/apps-and-dsh-2026-09-16`。
- 备份提交：`5aee73bb31657a178562b8ae87095eaef4cf914e`。
- 保存两个 `apps/` 应用、`packages/dsh-sdk-tools`、镜像工作流及其文档。
- 备份分支保存 Git 跟踪内容；应用本地配置、依赖和构建文件另保留于工作区外的 `.rescue/ts-dev-kits-boundary-2026-09-16/`。
- 备份分支已于 2026-09-16 推送到 origin。不要通过切换分支覆盖尚未提交的工具库改动。
- 查看历史可用 `git show backup/apps-and-dsh-2026-09-16:apps/account-panel/README.md`；未来迁移应用时从该分支另建工作树，不整体合并回主分支。

本次仓库分离不停止 NAS 上已运行的应用，不删除远端镜像或已发布包。
