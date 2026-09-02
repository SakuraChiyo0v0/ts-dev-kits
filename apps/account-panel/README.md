# account-panel

`apps/*` 里的媒体下载整合面板：聚合网易云音乐、B 站、番剧（Kazumi）三类内容源，登录态统一加密存 PostgreSQL，搜索 / 播放 / 下载一条龙，下载产物落到 NAS 目录。作为 ts-dev-kits monorepo 的 Web 应用标杆，端到端复用各 `@sakurachiyo0v0/*` SDK。

## 功能

| 模块 | 能力 |
| --- | --- |
| 首页 | 服务总览 |
| 音乐（网易云） | 扫码登录、搜索、歌单 / 收藏 / 红心、播放（真实取流、倍速、全屏歌词、睡眠定时）、单曲与批量下载、下载历史 |
| 哔哩哔哩 | 登录态、搜索 / 热门 / 排行榜 / 每周必看、稍后再看 / 收藏夹、视频解析与代理取流、下载（ffmpeg 合并）、历史 |
| 番剧（Kazumi） | 规则源聚合搜索、线路 / 集数选择、整季下载；无需平台账号，规则文件持久化到 `DOWNLOAD_DIR/kazumi/rules` |

## 架构

- 后端 Hono + `@hono/node-server`（SSE、静态托管、RPC），前端 React 19 + Vite 8 + Tailwind CSS 4，前后端类型安全走 Hono RPC（`hc<AppType>`）。
- 平台登录态统一经 `@sakurachiyo0v0/account` 的 `AuthStore` 写入配置中心（`@sakurachiyo0v0/config`，PostgreSQL 后端）的加密命名空间，本地只留缓存；扫码登录的二维码 / 状态经 SSE 推送。
- 面板本身**没有登录页**（已移除，打开即用）。但 `/api/bilibili/*`、`/api/kazumi/*` 含 proxy / seg 等代理出口且无会话保护，依赖部署边界：**只走内网或门户后面，不要把这个端口直接暴露公网**。

## 环境变量

复制 `.env.example` 为 `.env`（`pnpm dev` 会自动加载）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PG_URL` | 是 | PostgreSQL 连接串（配置中心：平台登录态 / 配置的存储后端） |
| `CONFIG_KEY` | 是 | 配置加密密钥。丢失后无法解密已存登录态，务必妥善备份 |
| `DOWNLOAD_DIR` | 否 | 下载 / 日志 / kazumi 规则根目录，容器内默认 `/downloads`；日志在 `<DOWNLOAD_DIR>/logs/app.log` |
| `PORT` | 否 | 服务端口，默认 8787 |
| `USE_SYSTEM_CHROMIUM` | 否 | `=1` 时用容器内系统 chromium（`/usr/bin/chromium-browser`），本地开发不需要 |

## 本地开发与运行

```bash
# 依赖安装（仓库根）
pnpm install

# 开发模式（server:8787 + client:5173，Vite proxy /api）
cd apps/account-panel
pnpm dev

# 生产构建 + 运行（先配好 .env 的 PG_URL / CONFIG_KEY）
pnpm build
NODE_ENV=production pnpm start
```

浏览器打开 http://localhost:5173（dev）或 http://localhost:8787（生产）。

## Docker 镜像构建

```bash
# 在仓库根构建（构建上下文必须是仓库根，见 Dockerfile 注释）
docker build -f apps/account-panel/Dockerfile -t account-panel .

# 运行（PG_URL / CONFIG_KEY 必填；下载目录挂到宿主）
docker run -d -p 8787:8787 \
  -e PG_URL=postgres://... \
  -e CONFIG_KEY=<key> \
  -e DOWNLOAD_DIR=/downloads \
  -v /volume1/docker/account-panel/data:/downloads \
  account-panel
```

## NAS 自动部署（push → ghcr → watchtower 自动重建）

本 app 已接上 push 自动部署链路，改完代码 `git push` 即可，无需登录 NAS：

```
push 到 GitHub main（命中 apps/account-panel/** 或 packages/**）
  -> .github/workflows/account-panel-image.yml 构建镜像
  -> 推 ghcr.io/sakurachiyo0v0/account-panel:{latest, <version>, <sha7>}
  -> NAS 上全局 watchtower 轮询到 latest digest 变化
  -> 自动 pull + 重建 account-panel 容器（镜像约 1.35GB，实测一轮 7–10 分钟；小镜像才是 1 分钟内）
```

### 仓库侧（已完成，只需知道）

- `.github/workflows/account-panel-image.yml`：push 到 main 且命中路径时，用 `GITHUB_TOKEN`（`permissions: packages: write`）登录 GHCR 并构建推送，打 `latest`（watchtower 追这个）+ `<version>`（读 `apps/account-panel/package.json`）+ `<sha7>`（回滚用）三个 tag。
- `apps/account-panel/Dockerfile`：以 monorepo 根为上下文的多阶段构建。
- `apps/account-panel/docker-compose.nas.yml`：NAS 部署 compose 模板，带 watchtower label。

### NAS 侧（一次性部署）

部署目录约定 `/volume1/docker/account-panel/`（root:root、权限 700，数据挂 `./data`）：

```bash
# 1. 建标准目录
sudo mkdir -p /volume1/docker/account-panel/data

# 2. 放入 compose 与 .env（base64 避免转义；.env 内容见 .env.example，chmod 600）
sudo tee /volume1/docker/account-panel/docker-compose.yaml   # 内容 = docker-compose.nas.yml

# 3. 属主 / 权限标准化（否则 UGOS Docker UI 识别异常）
sudo chown -R root:root /volume1/docker/account-panel
sudo chmod 700 /volume1/docker/account-panel

# 4. 启动（目录属 root，AmeChan 进不去，用 --project-directory）
sudo docker compose --project-directory /volume1/docker/account-panel \
  -f /volume1/docker/account-panel/docker-compose.yaml up -d
```

前提：

- **watchtower 只需全局部署一次**（此前 nas-hello 已跑通）。若还没有，用 `nas-hello/watchtower.compose.yml` 部署，**必须**覆盖 `DOCKER_API_VERSION=1.43`（镜像内置 1.25，UGOS dockerd 最低要求 1.40，不覆盖会循环重启）。
- （可选加速）ghcr 拉取慢可把 compose 镜像前缀 `ghcr.io/` 换成 `ghcr.nju.edu.cn/` 走南大镜像源（NAS 当前实际部署即如此；实测自动更新一轮 ~10.5min → ~7min，瓶颈在 NAS 本地解压）。CI 永远推官方 ghcr，想回退把前缀改回去即可。详见 NAS 侧 `docs/ugos-nas-ops.md` 第 14 节。
- 镜像仓库需可匿名拉取。本仓库是 public，GHCR 包实测随仓库公开、匿名可拉（HTTP 200）；若某天报 401，去 GitHub 仓库 → Packages → `account-panel` → Package settings 改 public。

### 验证

```bash
curl http://<nas>:8787/api/health     # {"ok":true}
# 改代码 / bump 版本后 git push，watchtower 自动重建（大镜像 7–10 分钟）；可用
# sudo docker ps 看容器启动时间，或看 /volume1/docker/account-panel/data/logs/app.log
```

相关坑（UGOS UI、目录权限、端口暴露边界）详见 NAS 侧运维文档 `docs/ugos-nas-ops.md` 第 9 / 12 节与 `nas-hello/README.md`。
