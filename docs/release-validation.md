# 发布检查与消费验证

本轮仅修改仓库检查、发布和消费验证工具，不修改 SDK 公共接口、源码或包版本。

## 判定规则

- Git 基准无效、Git 读取失败、manifest 损坏或包目录仍在但 manifest 缺失，版本检查失败。
- 发布相关改动必须提高语义化版本；版本倒退、仅改 build metadata 不算升级。包根 tests、docs、README 的既有豁免保持不变。
- 发布前逐个查询精确版本。只有 npm 明确返回 E404 才视为不存在；认证、网络、超时和异常响应全部失败。GitHub 对不可见资源也可能返回 404，无法仅靠此响应区分权限隐藏和真正不存在；实际发布仍需成功且复查目标版本。
- 已发布包的依赖以 registry 上该版本的 manifest 为准，递归检查内部运行时依赖。未发布包按 workspace 发布转换和发布顺序检查。范围解析使用 semver。
- 发布结束重新查询目标精确版本，避免把另一个 latest 当作成功。此检查不校验 tarball 字节是否与本地一致。

## 日常命令

```powershell
pnpm test:guards
node scripts/publish-packages.mjs --dry-run
node scripts/check-dependency-chain.mjs
pnpm verify:published @sakurachiyo0v0/email@0.2.2
pnpm verify:consumers
```

`--dry-run` 只查询，输出待发布清单，不发布。registry 命令需要当前用户的 GitHub Packages 读取权限。

`verify:published` 支持多个包，建议指定精确版本；省略版本时先解析 latest，再锁定版本安装。验证使用全新临时项目，不引用 workspace 源码，并检查安装版本、strict TypeScript（skipLibCheck=false）、ESM 和 CJS。

`verify:consumers` 根据本地 manifest 锁定 email、media-downloader、bilibili 三包版本，再执行本地替身/HTTP 服务的最小调用：邮件生命周期和校验、下载内容及历史持久化、Bilibili 参数和响应转换。不发真实邮件，不调用线上 Bilibili 服务。普通单包命令仅覆盖类型和导入。

临时项目保留便于复查；只写 registry 映射，认证继承用户配置或 CI 环境，不复制凭据。工具链版本取仓库实际安装的 TypeScript 和 @types/node，CI 由锁文件固定。

CI 在版本检查前安装锁定依赖，在发布后执行三包消费验收。CI 修改需后续推送才会在 GitHub 实际运行；本地通过不等同于远端已验证。

## 配置后端拆分验收

`pnpm verify:config-packages` 先打出真实 tarball，再在四个独立临时项目安装，验证本地账号、config 核心、WebDAV 和 PG 的运行依赖排除规则，并检查严格类型、ESM/CJS 和最小调用。CI validate 在 pnpm check 后执行。PG 消费夹具只构造/关闭后端，不连接真实数据库；SQL 行为由 config-pg 驱动替身测试覆盖，WebDAV 协议读写由 config-webdav 本地服务器测试覆盖。

注意：pnpm pack 会执行 prepare 并重建 dist。请在构建/测试结束后串行执行 verify:config-packages；不能与依赖 dist 的 CLI 测试并行。CI 已按此顺序执行。
