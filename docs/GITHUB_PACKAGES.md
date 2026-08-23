# GitHub Packages 包仓库

所有 `@sakurachiyo0v0/*` 包发布到 GitHub Packages,消费方一条 `pnpm add` 即可安装。

> 仓库 `SakuraChiyo0v0/ts-dev-kits` 已设为 **public**,包公开可读 —— **安装方无需 token**;
> 只有**发布新版本**才需要 token(见下文)。

## 消费方安装(任何项目/机器,无需 token)

在项目根目录或用户目录 `.npmrc` 添加一行(把 `@sakurachiyo0v0` 指向 GitHub Packages 的 registry):

```ini
@sakurachiyo0v0:registry=https://npm.pkg.github.com/
```

然后:

```powershell
pnpm add @sakurachiyo0v0/bilibili          # 自动带上 account / cli-utils / ffmpeg
pnpm add @sakurachiyo0v0/email
```

> 其它依赖(如 `qrcode`、`nodemailer`)仍走公共 npm,无需额外配置。

## 发布新版本(仅仓库维护者,需要 token)

### 1. 创建 PAT(访问令牌)

GitHub → 头像 → `Settings` → `Developer settings` → `Personal access tokens` → `Tokens (classic)` → `Generate new token`,勾选 `repo` + `write:packages` + `read:packages`。

### 2. 配置 .npmrc(用户目录,发布用)

```ini
@sakurachiyo0v0:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=ghp_你的token
```

### 3. 发布

```powershell
node scripts/publish-packages.mjs
```

脚本按依赖顺序发布(`cli-utils → account → email → ffmpeg → lol → netease-music → bilibili → chat-platforms → dsh-sdk-tools`),发布时自动把 `workspace:*` 依赖转为实际版本号。

- 首次发布版本 `0.1.0`;后续发新版需手动 bump 对应包的 `version` 字段
- 同版本重复发布会失败,需先 bump 或删除已发布版本
