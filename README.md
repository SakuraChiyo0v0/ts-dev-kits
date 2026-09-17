# ts-dev-kits

可复用 TypeScript / Node.js 工具库。各包独立版本，发布到 **GitHub Packages**，由其他项目安装使用。主分支不承载成熟应用、部署服务或宿主专用插件。

## 工具包

当前共 22 个包，统一使用 `@sakurachiyo0v0/` 前缀。

| 职责 | 包 |
| --- | --- |
| [通用基础](docs/packages-index.md#foundation) | [logger](packages/logger/README.md)、[cli-utils](packages/cli-utils/README.md) |
| [存储与配置](docs/packages-index.md#storage) | [config](packages/config/README.md)、[config-webdav](packages/config-webdav/README.md)、[config-pg](packages/config-pg/README.md)、[webdav](packages/webdav/README.md)、[database](packages/database/README.md) |
| [账号认证](docs/packages-index.md#auth) | [account](packages/account/README.md) |
| [媒体与通用工具](docs/packages-index.md#utilities) | [ffmpeg](packages/ffmpeg/README.md)、[media-downloader](packages/media-downloader/README.md)、[chuanshengtong](packages/chuanshengtong/README.md)、[email](packages/email/README.md) |
| [平台 SDK](docs/packages-index.md#platforms) | [bilibili](packages/bilibili/README.md)、[netease-music](packages/netease-music/README.md)、[booth](packages/booth/README.md)、[steam](packages/steam/README.md)、[vrchat](packages/vrchat/README.md)、[xiaoheihe](packages/xiaoheihe/README.md)、[lol](packages/lol/README.md)、[ugreen](packages/ugreen/README.md)、[chat-platforms](packages/chat-platforms/README.md)、[kazumi](packages/kazumi/README.md) |

目录保留 `packages/<包名>` 平铺；上表用于按用途查找，依赖方向另由 [边界规则](docs/repository-boundaries.md#依赖方向) 约束。职责分类不等同于构建顺序。版本与接口见 [包索引](docs/packages-index.md) 和各包 README；本地版本不代表该版本已发布。

## 在其他项目使用

在消费项目 `.npmrc` 配置 registry；令牌通过环境变量提供，不提交实际令牌：

```ini
@sakurachiyo0v0:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

`NODE_AUTH_TOKEN` 使用具有 `read:packages` 权限的 GitHub classic PAT。公开 npm 包也需要认证，详见 [GitHub 官方说明](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)。

```powershell
pnpm add --save-exact @sakurachiyo0v0/email
```

通过公开入口导入，例如 `import { EmailClient } from "@sakurachiyo0v0/email"`。不要引用本仓库源码路径。原生依赖、外部二进制及运行要求见各包文档。

## 本地维护

需要 Node.js 20+、pnpm 11.15.1；CI 使用 Node.js 24。

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @sakurachiyo0v0/email test
```

`pnpm check` 依次执行版本守卫回归测试、工具库边界检查、按依赖顺序构建、类型检查、测试、CLI 冒烟、skill 同步和包索引检查。先构建确保干净检出也有跨包类型声明。

发布清单的唯一来源是 `scripts/packages-list.mjs`；根构建自动涵盖全部 workspace 工具包。

## 发布与消费验证

包内容变化时按语义化版本更新版本号。现有 CI 在推送到 `main` 后通过检查，再发布版本有变化的包。**推送 main 可能触发发布**，提交、推送和发布分别按授权执行。

```powershell
pnpm verify:published @sakurachiyo0v0/email@0.2.2
pnpm verify:consumers
```

失败判据与自动验收见 [发布检查与消费验证](docs/release-validation.md)。

发布配置、消费认证和验证步骤见 [GitHub Packages 手册](docs/GITHUB_PACKAGES.md)。

## 仓库边界与备份

- [工具库边界](docs/repository-boundaries.md)：哪些内容留在仓库、如何恢复历史应用。
- [SDK 开发流程](docs/sdk-development-workflow.md)：实现、测试、文档与版本管理。
- [新包模板](docs/package-template.md)：新增包的结构与约定。

历史应用 `account-panel`、`browser-proxy` 和 DSH 适配包保存在备份分支 `backup/apps-and-dsh-2026-09-16`（已推送到 origin），不在主分支继续开发；暂未建立独立应用仓库。

配置后端按需安装及 config 1.0 迁移见 [迁移说明](docs/config-backends-migration.md)。
