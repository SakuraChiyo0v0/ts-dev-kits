# ts-dev-kits

个人 TypeScript 开发工具 monorepo。远程仓库为私有 GitHub 仓库 [`SakuraChiyo0v0/ts-dev-kits`](https://github.com/SakuraChiyo0v0/ts-dev-kits)。

## 当前包

| 名称 | 用途 | 状态 |
| --- | --- | --- |
| `@sakurachiyo0v0/email` | 与供应商解耦的 Node.js 邮件 SDK | SMTP 适配器可用 |
| `@sakurachiyo0v0/ffmpeg` | FFmpeg/ffprobe 进程封装与媒体处理函数 | 可用 |

## 开始使用

需要 Node.js 20+ 和 pnpm 11。

```powershell
pnpm install
pnpm check
```

常用命令：

```powershell
pnpm --filter @sakurachiyo0v0/email test
pnpm --filter @sakurachiyo0v0/email build
pnpm --filter @sakurachiyo0v0/ffmpeg test
pnpm --filter @sakurachiyo0v0/ffmpeg build
pnpm verify:email-package
pnpm verify:email-git-package
```

## 使用 `@sakurachiyo0v0/email`

在本 monorepo 的其他 workspace 包中：

```powershell
pnpm add @sakurachiyo0v0/email@workspace:*
```

在另一台已获得私有仓库访问权限的电脑上，先为 Git 依赖的构建脚本添加精确授权：

```yaml
# 消费项目的 pnpm-workspace.yaml
allowBuilds:
  '@sakurachiyo0v0/email@git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git': true
```

然后安装 monorepo 子目录：

```powershell
pnpm add "git+https://github.com/SakuraChiyo0v0/ts-dev-kits.git#path:/packages/email"
```

完整 API、SMTP 配置和固定提交示例见 [`packages/email/README.md`](packages/email/README.md)。

## 版本约定

可复用包遵循语义化版本。跨机器使用时优先把依赖固定到已审核的提交；正式版本使用不可变 Git tag，避免默认分支更新改变既有项目的安装结果。

暂不向公共 npm registry 发布。Git 提交、推送、tag 和发布是独立操作，不由构建或测试命令自动执行。
