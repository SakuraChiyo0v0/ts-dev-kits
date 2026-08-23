# SDK 功能开发流程(一条龙)

本文定义在 `ts-dev-kits` monorepo 中**一个 SDK 功能从想法到发布**的完整路径。
每个环节标注:做什么、参考模板在哪、自动守卫是什么、验收标准是什么。
适合新增一个功能模块(如 bilibili 的收藏夹 API)或新增一个包(如 `@sakurachiyo0v0/lol`)。

```text
想法 → 设计 spec → 实现 → 测试 → 文档 → CLI + skill 同步
     → 版本 bump → pnpm check → 提交(守卫自动拦) → push → CI 发布 → 消费验证
```

---

## 阶段 0:想法确认

- 明确:这是「给现有包加功能」还是「新建包」?
  - 加功能:在 `packages/<name>/src/api/` 新增领域模块,接进 `client.ts`。
  - 新包:按 `docs/package-template.md` 建骨架,更新 `docs/packages-index.md`。
- 若涉及多个独立子系统,先分解,每个子系统走一遍本流程。

## 阶段 1:设计 spec

- 模板:`docs/superpowers/specs/spec-template.md`(已就位)。
- 落盘:`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`。
- 必须包含:目标、前后变化、方案取舍(2-3 个候选 + 推荐)、接口形状、错误码、
  测试策略、验收条件。
- 完成后找用户审阅,批准后再实现。

**守卫**:无(设计是文档,不自动校验)。

## 阶段 2:实现

- 结构:按 `docs/package-template.md`(新包)或现有包的 `src/api/` 模式(加功能)。
- 代码风格见 AGENTS.md「代码风格」节:
  - 严格 TS(strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`);
  - 可选属性用 `...(x ? { x } : {})` 展开;
  - 统一错误类 + 错误码,消息脱敏;
  - 公共接口保持供应商无关,适配器可替换。

## 阶段 3:测试

- **真实协议路径优先**:本地 mock 服务器/真实 API 冒烟(如 bilibili 的 `BILI_SMOKE=1`,
  email 的本地 `smtp-server`)。
- 写操作要**自清理**(测试结束恢复现场),涉及登录态用测试账号或本地 mock。
- 覆盖错误分支:登录失效、网络失败、磁盘不足、超时、参数非法。

**守卫**:`pnpm --filter <包> typecheck && test`。

## 阶段 4:文档

- `packages/<name>/README.md`:安装方式、API、参数表、错误码表、示例。
- `docs/packages-index.md`:总览表更新版本号 + 详情节补新 API。
- 错误码/行为变化同步到相关 skill(见阶段 5)。

## 阶段 5:CLI + skill 同步

- 若功能暴露到 CLI(`packages/<name>/src/cli/*.ts`),**必须**同步对应
  `skills/<name>-cli/SKILL.md`:
  - 新增/改名/删除命令 → 更新 skill 命令速查;
  - 参数/语义/文档表变化(登录方式、编码表等)→ 更新 skill 对应节;
  - 对照表来源以源码为准(如 `types.ts` 的枚举是 codecId 权威定义)。

**守卫**:`scripts/check-skill-staleness.mjs`(pre-commit 自动跑)
- 命令集不一致 → **阻止提交**;
- CLI mtime 晚于 SKILL.md → **警告**(检查参数/语义)。

## 阶段 6:版本 bump

- 改了 `packages/**` 内容就**必须** bump `package.json` 的 `version`:
  - patch:bug 修复;minor:新功能;major:破坏性变更。
- 同步更新 `docs/packages-index.md` 总览表里的版本号。

**守卫**:`scripts/check-package-bumps.mjs`(pre-commit 自动跑)
- 改了包内容但版本没 bump → **阻止提交**。

## 阶段 7:全仓验证

```powershell
pnpm check   # typecheck + test + build + skill 同步校验
```

**守卫**:`pnpm check` 全绿(含 `check-skill-staleness.mjs`)。

## 阶段 8:提交 + 推送

- conventional 提交信息(`feat:`/`fix:`/`docs:`/`refactor:`),英文。
- 提交身份用 GitHub 账号(`SakuraChiyo0v0`)。
- **未经用户明确说"提交"/"推送",不执行 `git commit` / `git push`。**
- pre-commit 自动跑:repo-structure 同步 + 版本守卫 + skill 守卫。

**守卫**:`.githooks/pre-commit`(三个守卫 + 结构页自动同步)。

## 阶段 9:CI 发布

- push 到 `main` 触发 `.github/workflows/publish.yml`:
  - `check-versions` job:再跑一次版本守卫,防止绕过;
  - `publish` job:按依赖顺序发布版本有变化的包到 GitHub Packages
    (`scripts/publish-packages.mjs`)。
- 发布后确认 registry 上出现新版本:
  `npm view @sakurachiyo0v0/<name> version --registry=https://npm.pkg.github.com/`

**守卫**:CI 的 `check-versions` job。

## 阶段 10:消费验证(发布后)

- 通用验证脚本:`scripts/verify-published-package.mjs <包名>`(已就位)。
- 对发布到 GitHub Packages 的包,从**全新临时项目**安装并验证 ESM/CJS 双模式可导入,
  确保开箱即用(依赖从 GitHub Packages 正确解析)。
- 示例:`pnpm verify:published @sakurachiyo0v0/bilibili`

---

## 快速清单(新增一个功能时的核对表)

- [ ] spec 已写并经用户批准
- [ ] 实现按包模板/现有模式,严格 TS
- [ ] 测试覆盖真实协议路径 + 错误分支,写操作自清理
- [ ] README + packages-index 更新
- [ ] CLI 命令变化已同步 skill(守卫会拦)
- [ ] 版本已 bump(守卫会拦)
- [ ] `pnpm check` 全绿
- [ ] 用户确认后提交 + 推送
- [ ] CI 发布成功,registry 有新版本
- [ ] `pnpm verify:published <包名>` 消费验证通过

## 相关文档

- `docs/package-template.md` — 新包目录/构建/接线模板
- `docs/superpowers/specs/spec-template.md` — spec 模板
- `docs/packages-index.md` — 包总览 + 详情
- `AGENTS.md` — 仓库工作指南(环境/风格/Git 流程)
- `scripts/check-package-bumps.mjs` / `scripts/check-skill-staleness.mjs` — 提交守卫
- `scripts/publish-packages.mjs` / `scripts/verify-published-package.mjs` — 发布与验证
