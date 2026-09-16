# GitHub Packages 包仓库

本仓库的工具包发布至 `https://npm.pkg.github.com/`，不发布到公共 npm registry。发布清单见 `scripts/packages-list.mjs`，包版本见各 `package.json`。

## 外部项目安装

GitHub Packages npm registry 的公开包同样需要认证。使用有 `read:packages` 权限的 classic PAT；令牌只存环境变量或用户配置，不提交仓库。

```ini
@sakurachiyo0v0:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```powershell
pnpm add --save-exact @sakurachiyo0v0/bilibili
```

内部 `workspace:*` 依赖在 pnpm 打包发布时转换为实际版本。外部消费项目无需加入本仓库的 workspace，也不应引用 `src/`。原生模块的安装脚本按消费项目策略和包文档配置。

## 维护者发布

1. 按语义化版本更新受影响包，同步包索引。
2. 运行 `pnpm check`。
3. 检查依赖链，确保依赖版本存在或会在本批次先发布。
4. 经授权推送 `main` 后，现有 `publish.yml` 校验版本、依赖链及工具库，随后发布变化的版本。
5. 在临时消费项目安装已发布版本，验证 ESM/CJS 导入。

CI 沿用已有 `GH_PACKAGES_TOKEN` secret；需有包读写权限。手动发布也需要有 `write:packages` 权限的认证。仓库 `.npmrc` 仅保存 scope 到 registry 的映射；认证由用户配置或 CI 注入。

```powershell
# 仅获发布授权后执行
node scripts/publish-packages.mjs
# 发布后验证，不执行发布
pnpm verify:published @sakurachiyo0v0/email
```

发布命令显式指定 GitHub registry。相同版本跳过，版本变化才发布。应用镜像构建不属于本仓库发布流程。

## 证据边界

本地构建和测试通过不代表 GitHub 上已发布。只有 registry 出现目标版本，且外部项目实际安装与导入成功，才能确认可消费。此次边界整理不执行推送或发布，也不删除历史包。

依据：[GitHub 官方 npm registry 文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)。
