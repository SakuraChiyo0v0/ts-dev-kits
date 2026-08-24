# ts-dev-kits

个人 TypeScript 开发工具 monorepo。远程仓库为私有 GitHub 仓库 [`SakuraChiyo0v0/ts-dev-kits`](https://github.com/SakuraChiyo0v0/ts-dev-kits)。

## 当前包

| 名称 | 用途 | 状态 |
| --- | --- | --- |
| `@sakurachiyo0v0/cli-utils` | 各 SDK CLI 共享的解析/输出/错误工具 | 可用 |
| `@sakurachiyo0v0/ffmpeg` | FFmpeg/ffprobe 进程封装与媒体处理函数 | 可用 |
| `@sakurachiyo0v0/email` | 与供应商解耦的 Node.js 邮件 SDK | SMTP 适配器可用 |
| `@sakurachiyo0v0/bilibili` | B 站视频下载 SDK(解析/取流/下载/ffmpeg 合并) | 可用(投稿视频) |
| `@sakurachiyo0v0/chat-platforms` | 统一聊天平台接入 SDK(消息模型/适配器注册表,当前飞书) | 可用 |
| `@sakurachiyo0v0/lol` | 英雄联盟 LCU 本地能力 SDK | 可用(查询+对局感知,国服 SGP) |
| `@sakurachiyo0v0/vrchat` | VRChat 官方 REST API SDK(认证/用户/世界/头像/实例/好友/通知/收藏/群组/文件/经济/审核) | 可用(全功能覆盖) |
| `@sakurachiyo0v0/steam` | Steam SDK(查询向):Web API / Storefront / Community 三套接口,登录态支持(密码+Guard/TOTP/QR/cookie),写操作仅激活码兑换 | 可用(全阶段交付) |
| `@sakurachiyo0v0/xiaoheihe` | 小黑盒 SDK:扫码登录 + hkey/nonce 签名 + 只读查询(帖子/评论/feed/@消息/用户) | 可用(P0 只读) |

所有包已发布到 GitHub Packages,详见下方「发布流程」。

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

## 发布流程(GitHub Packages + CI 自动发布)

所有包发布到 **GitHub Packages**(`npm.pkg.github.com`,仓库公开,安装方无需 token)。发布由 **CI 自动完成**:push 到 `main` 时,`.github/workflows/publish.yml` 会检测各包本地版本与已发布版本,有变化的按依赖顺序(`cli-utils → account → email → ffmpeg → lol → netease-music → booth → bilibili → chat-platforms → vrchat → steam → xiaoheihe → dsh-sdk-tools`)自动发布,并把 `workspace:*` 依赖转成实际版本号。

### ⚠️ 更新包必须按需 bump 版本号

**CI 只发布版本有变化的包** —— 版本号不变(哪怕代码改了)也会被跳过,不会重复发布同版本。因此每次更新包内容,务必同步提升该包 `package.json` 的 `version`(语义化版本,如 `0.1.0` → `0.1.1` / `0.2.0`):

```powershell
# 1. 改 packages/<name>/package.json 的 version
# 2. 提交并推送
git add packages/<name>/package.json
git commit -m "chore: bump <name> to 0.2.0"
git push origin main     # CI 自动检测并发布
```

### 消费方安装(任何项目/机器)

```ini
# .npmrc 加一行
@sakurachiyo0v0:registry=https://npm.pkg.github.com/
```

```powershell
pnpm add @sakurachiyo0v0/bilibili          # 自动带上 account / cli-utils / ffmpeg
pnpm add @sakurachiyo0v0/email
```

### 手动发布(CI 之外,可选)

```powershell
node scripts/publish-packages.mjs
```

脚本可重复执行:已发布且版本相同的包会自动跳过。完整说明见 [`docs/GITHUB_PACKAGES.md`](docs/GITHUB_PACKAGES.md)。

## 版本约定

可复用包遵循语义化版本。跨机器使用时优先把依赖固定到已审核的提交;正式版本使用不可变 Git tag,避免默认分支更新改变既有项目的安装结果。

Git 提交、推送、tag 和发布是独立操作:**提交/推送不会自动发布** —— 发布只发生在「push 到 main + 对应包版本有变化」时(CI 触发),或手动运行发布脚本。
